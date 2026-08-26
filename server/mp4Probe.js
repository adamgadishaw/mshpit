import { createHash } from "node:crypto";

import { ApiError } from "./errors.js";
import { getMediaConfig, presignS3Request } from "./media.js";
import {
  VIDEO_VERIFIER_MAX_DISCARDED_QUICKTIME_TRACKS,
  VIDEO_VERIFIER_SOURCE_CONTENT_TYPES,
  videoVerifierSourceExtension,
} from "./videoVerifierProtocol.js";
import {
  MEDIA_VIDEO_MAX_DURATION_MS,
  MEDIA_VIDEO_MAX_FRAME_RATE,
  MEDIA_VIDEO_MAX_SAMPLES,
} from "../src/domain/mediaUploadPolicy.mjs";


const KIBIBYTE = 1024;
const MEBIBYTE = 1024 * KIBIBYTE;

const MAX_MOOV_BYTES = 4 * MEBIBYTE;
const MAX_FTYP_BYTES = 64 * KIBIBYTE;
const MAX_FIRST_SAMPLE_BYTES = 4 * MEBIBYTE;
const MAX_TOTAL_RESPONSE_BYTES = MAX_MOOV_BYTES + MAX_FIRST_SAMPLE_BYTES + 256 * KIBIBYTE;
const MAX_TOP_LEVEL_BOXES = 64;
const MAX_PARSED_BOXES = 1_024;
const MAX_SAMPLE_ENTRIES = 256;
const MAX_MEDIA_SAMPLES = 250_000;
// Full-decode admission is intentionally narrower than the table parser's
// memory bound. One video sample is one compressed picture for the admitted AVC
// layout, so these checks cap both frame rate and pixels decoded before an
// account can occupy the isolated verifier. The envelope admits a ten-minute
// 1080p60 concert clip, while rejecting high-sample-rate and 4K decode bombs.
const MAX_VIDEO_SAMPLES_PER_SECOND = MEDIA_VIDEO_MAX_FRAME_RATE;
const MAX_VIDEO_SAMPLE_SLACK = 2;
// 1080p is coded as 120x68 macroblocks (1920x1088), so use coded
// macroblocks—not cropped display dimensions—for the decode-work envelope.
const MAX_VIDEO_CODED_PIXEL_SAMPLES = 120n * 68n * 256n * BigInt(MEDIA_VIDEO_MAX_SAMPLES);
const MAX_CHUNKS = 250_000;
const MAX_TIMING_ENTRIES = 65_536;
const MAX_RANGE_REQUESTS = 72;
const MAX_WALL_MS = 12_000;
// The web process performs structural admission before the isolated decoder.
// Each probe can retain roughly eight MiB of bounded MP4 tables/sample data, so
// this fixed process-wide gate protects unrelated API/SQLite work on the
// Starter instance. There is intentionally no queue: excess distinct work gets
// a retryable response before any R2 request, while an identical generation
// joins the already-running proof.
export const MAX_CONCURRENT_MP4_STRUCTURAL_PROBES = 2;
const MAX_CLIP_DURATION_MS = MEDIA_VIDEO_MAX_DURATION_MS;
const MAX_VIDEO_WIDTH = 4_096;
const MAX_VIDEO_HEIGHT = 2_160;

const VIDEO_SAMPLE_ENTRIES = new Set(["avc1", "avc3", "hvc1"]);
const QUICKTIME_VIDEO_SAMPLE_ENTRIES = new Set(["avc1", "hvc1"]);
const AUDIO_SAMPLE_ENTRIES = new Set(["mp4a"]);
const AVC_PROFILES = new Set([66, 77, 100]);
const AVC_LEVELS = new Set([9, 10, 11, 12, 13, 20, 21, 22, 30, 31, 32, 40, 41, 42, 50, 51]);
const AVC_LEVEL_MAX_FRAME_MBS = new Map([
  [9, 99], [10, 99], [11, 396], [12, 396], [13, 396], [20, 396],
  [21, 792], [22, 1_620], [30, 1_620], [31, 3_600], [32, 5_120],
  [40, 8_192], [41, 8_192], [42, 8_704], [50, 22_080], [51, 36_864],
]);
const AAC_SAMPLE_RATES = Object.freeze([
  96_000, 88_200, 64_000, 48_000, 44_100, 32_000, 24_000,
  22_050, 16_000, 12_000, 11_025, 8_000, 7_350,
]);
const ISO_MP4_MAJOR_BRANDS = new Set(["isom", "mp41", "mp42"]);
const ISO_MP4_COMPATIBLE_BRANDS = new Set(["isom", "iso2", "iso3", "iso4", "iso5", "iso6", "avc1", "hvc1", "mp41", "mp42"]);
const QUICKTIME_MAJOR_BRAND = "qt  ";
const QUICKTIME_COMPATIBLE_BRANDS = new Set([QUICKTIME_MAJOR_BRAND]);
const QUICKTIME_DISCARDED_TRACK_HANDLERS = new Set(["meta", "tmcd"]);
const DOLBY_VISION_CONFIGURATION_BOXES = new Set(["dvcC", "dvvC"]);
const SOURCE_CONTENT_TYPES = new Set(VIDEO_VERIFIER_SOURCE_CONTENT_TYPES);
const STREAMING_ONLY_BOXES = new Set(["moof", "mfra", "sidx", "styp"]);

const activeStructuralProbes = new Map();
const fetchImplementationIds = new WeakMap();
let nextFetchImplementationId = 1;

function unsupported() {
  return new ApiError(415, "That video container is not compatible with PIT clips.", "MEDIA_TYPE_UNSUPPORTED");
}

function unavailable() {
  return new ApiError(503, "The clip could not be inspected in storage yet. Try again.", "MEDIA_STORAGE_UNAVAILABLE");
}

function changedDuringInspection() {
  return new ApiError(409, "The uploaded clip changed while it was being inspected. Try again.", "CONFLICT");
}

function structuralProbeBusy() {
  return new ApiError(429, "Clip inspection is busy. Try again shortly.", "RATE_LIMITED");
}

function fetchImplementationId(fetchImpl) {
  let identity = fetchImplementationIds.get(fetchImpl);
  if (!identity) {
    identity = nextFetchImplementationId;
    nextFetchImplementationId += 1;
    fetchImplementationIds.set(fetchImpl, identity);
  }
  return identity;
}

function structuralProbeIdentity(state) {
  const credential = createHash("sha256")
    .update(`${state.config.accessKeyId}\0${state.config.secretAccessKey}`)
    .digest("hex");
  return createHash("sha256").update([
    state.objectUrl,
    state.expectedBytes,
    state.ifMatch || "",
    state.contentType,
    state.storageScope,
    state.config.region,
    credential,
    fetchImplementationId(state.fetchImpl),
  ].join("\0")).digest("hex");
}

function waitForStructuralProbe(job, signal) {
  if (signal?.aborted) {
    return Promise.reject(signal.reason || new DOMException("Aborted", "AbortError"));
  }
  job.waiters += 1;
  return new Promise((resolve, reject) => {
    let released = false;
    const release = () => {
      if (released) return false;
      released = true;
      signal?.removeEventListener?.("abort", onAbort);
      job.waiters = Math.max(0, job.waiters - 1);
      if (!job.settled && job.waiters === 0 && !job.controller.signal.aborted) {
        job.controller.abort(new DOMException("All structural-probe callers disconnected", "AbortError"));
      }
      return true;
    };
    const onAbort = () => {
      if (!release()) return;
      reject(signal.reason || new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener?.("abort", onAbort, { once: true });
    job.promise.then(
      (value) => {
        if (!release()) return;
        resolve(value);
      },
      (error) => {
        if (!release()) return;
        reject(error);
      },
    );
  });
}

function endpointObjectUrl(config, objectKey) {
  const encode = (value) => encodeURIComponent(value)
    .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  const prefix = config.endpoint.pathname.replace(/\/+$/, "");
  const suffix = [config.bucket, ...objectKey.split("/")].map(encode).join("/");
  return `${config.endpoint.origin}${prefix}/${suffix}`;
}

function normalizedObjectKey(value) {
  const key = typeof value === "string" ? value.trim() : "";
  if (!key || key.length > 1_024 || key.startsWith("/") || key.includes("\\")
      || /[\u0000-\u001f\u007f]/u.test(key)
      || key.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw unavailable();
  }
  return key;
}

function normalizedSourceContentType(value, objectKey) {
  const type = String(value || "video/mp4").split(";", 1)[0].trim().toLowerCase();
  const extension = videoVerifierSourceExtension(type);
  if (!SOURCE_CONTENT_TYPES.has(type) || !extension
      || !String(objectKey || "").toLowerCase().endsWith(`.${extension}`)) {
    throw unsupported();
  }
  return type;
}

function normalizedIfMatch(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 256 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw unavailable();
  }
  return value;
}

function ensureWithinDeadline(state) {
  if (Date.now() >= state.deadline) throw unavailable();
}

function parseContentRange(value) {
  const match = /^bytes ([0-9]+)-([0-9]+)\/([0-9]+)$/u.exec(String(value || "").trim());
  if (!match) return null;
  const numbers = match.slice(1).map(Number);
  return numbers.every(Number.isSafeInteger)
    ? { start: numbers[0], end: numbers[1], total: numbers[2] }
    : null;
}

async function readExactBody(response, expectedLength) {
  const declaredLength = response.headers?.get?.("content-length");
  if (declaredLength !== null && declaredLength !== undefined && declaredLength !== "") {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength !== expectedLength) throw unavailable();
  }

  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        received += chunk.length;
        if (received > expectedLength) {
          try { await reader.cancel(); } catch {}
          throw unavailable();
        }
        chunks.push(chunk);
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw unavailable();
    }
    if (received !== expectedLength) throw unavailable();
    return Buffer.concat(chunks, received);
  }

  let body;
  try {
    body = Buffer.from(await response.arrayBuffer());
  } catch {
    throw unavailable();
  }
  if (body.length !== expectedLength) throw unavailable();
  return body;
}

async function getRange(state, start, end) {
  ensureWithinDeadline(state);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start
      || end >= state.expectedBytes) {
    throw unsupported();
  }
  const expectedLength = end - start + 1;
  if (state.requests >= MAX_RANGE_REQUESTS || state.responseBytes + expectedLength > MAX_TOTAL_RESPONSE_BYTES) {
    throw unsupported();
  }
  state.requests += 1;

  const range = `bytes=${start}-${end}`;
  const signedHeaders = { Range: range };
  if (state.ifMatch) signedHeaders["If-Match"] = state.ifMatch;

  let signedUrl;
  try {
    signedUrl = presignS3Request({
      method: "GET",
      url: state.objectUrl,
      region: state.config.region,
      accessKeyId: state.config.accessKeyId,
      secretAccessKey: state.config.secretAccessKey,
      headers: signedHeaders,
      expiresIn: 60,
    });
  } catch {
    throw unavailable();
  }

  const remainingMs = Math.max(1, state.deadline - Date.now());
  const timeoutSignal = AbortSignal.timeout(remainingMs);
  const requestSignal = state.signal
    ? AbortSignal.any([state.signal, timeoutSignal])
    : timeoutSignal;
  try {
    let response;
    try {
      response = await state.fetchImpl(signedUrl, {
        method: "GET",
        headers: signedHeaders,
        redirect: "error",
        signal: requestSignal,
      });
    } catch {
      throw unavailable();
    }
    if (response?.status === 412) throw changedDuringInspection();
    if (!response || response.status !== 206) throw unavailable();

    const contentEncoding = String(response.headers?.get?.("content-encoding") || "").trim().toLowerCase();
    if (contentEncoding && contentEncoding !== "identity") throw unavailable();
    const contentRange = parseContentRange(response.headers?.get?.("content-range"));
    if (!contentRange || contentRange.start !== start || contentRange.end !== end
        || contentRange.total !== state.expectedBytes) {
      throw unavailable();
    }

    const body = await readExactBody(response, expectedLength);
    state.responseBytes += body.length;
    ensureWithinDeadline(state);
    return body;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw unavailable();
  }
}

function fourCc(buffer, offset) {
  return buffer.toString("latin1", offset, offset + 4);
}

function uint64(buffer, offset) {
  const value = buffer.readBigUInt64BE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw unsupported();
  return Number(value);
}

function parseBoxHeader(buffer, offset, end, parseState, { count = true } = {}) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end < offset
      || end > buffer.length || end - offset < 8) {
    throw unsupported();
  }
  if (count) {
    parseState.boxes += 1;
    if (parseState.boxes > MAX_PARSED_BOXES) throw unsupported();
  }

  const size32 = buffer.readUInt32BE(offset);
  const type = fourCc(buffer, offset + 4);
  let headerSize = type === "uuid" ? 24 : 8;
  let size;
  let extendsToEnd = false;
  if (size32 === 0) {
    size = end - offset;
    extendsToEnd = true;
  } else if (size32 === 1) {
    if (end - offset < 16) throw unsupported();
    size = uint64(buffer, offset + 8);
    headerSize += 8;
  } else {
    size = size32;
  }
  if (size < headerSize || size > end - offset) throw unsupported();
  return {
    type,
    start: offset,
    end: offset + size,
    size,
    headerSize,
    payloadStart: offset + headerSize,
    extendsToEnd,
  };
}

function listBoxes(buffer, start, end, parseState) {
  const boxes = [];
  let cursor = start;
  while (cursor < end) {
    const box = parseBoxHeader(buffer, cursor, end, parseState);
    boxes.push(box);
    cursor = box.end;
  }
  if (cursor !== end) throw unsupported();
  return boxes;
}

function onlyBox(boxes, type, { required = true } = {}) {
  const matches = boxes.filter((box) => box.type === type);
  if (matches.length > 1 || (required && matches.length !== 1)) throw unsupported();
  return matches[0] || null;
}

function validateFtyp(buffer, parseState, contentType) {
  const box = parseBoxHeader(buffer, 0, buffer.length, parseState);
  if (box.type !== "ftyp" || box.end !== buffer.length || box.extendsToEnd) throw unsupported();
  const payloadBytes = box.end - box.payloadStart;
  if (payloadBytes < 8 || (payloadBytes - 8) % 4 !== 0) throw unsupported();
  const majorBrand = fourCc(buffer, box.payloadStart);
  const compatibleBrands = [];
  for (let cursor = box.payloadStart + 8; cursor < box.end; cursor += 4) {
    compatibleBrands.push(fourCc(buffer, cursor));
  }
  const validMp4 = contentType === "video/mp4"
    && ISO_MP4_MAJOR_BRANDS.has(majorBrand)
    && compatibleBrands.length
    && compatibleBrands.every((brand) => ISO_MP4_COMPATIBLE_BRANDS.has(brand));
  const validQuickTime = contentType === "video/quicktime"
    && majorBrand === QUICKTIME_MAJOR_BRAND
    && compatibleBrands.length
    && compatibleBrands.every((brand) => QUICKTIME_COMPATIBLE_BRANDS.has(brand));
  if (!validMp4 && !validQuickTime) {
    throw unsupported();
  }
}

function listSampleEntryBoxes(buffer, start, end, parseState, {
  allowQuickTimeZeroPadding = false,
} = {}) {
  const boxes = [];
  let cursor = start;
  while (cursor < end) {
    // iPhone AVC sample entries terminate their otherwise ordinary child-box
    // list with one four-byte zero alignment word. Accept that exact padding
    // only at a child boundary in QuickTime mode; arbitrary trailers and ISO
    // MP4 entries remain rejected.
    if (allowQuickTimeZeroPadding && end - cursor === 4
        && buffer.readUInt32BE(cursor) === 0) {
      cursor = end;
      break;
    }
    const box = parseBoxHeader(buffer, cursor, end, parseState);
    boxes.push(box);
    cursor = box.end;
  }
  if (cursor !== end) throw unsupported();
  return boxes;
}

function parseMovieDuration(buffer, box) {
  const payloadBytes = box.end - box.payloadStart;
  if (payloadBytes < 20) throw unsupported();
  const version = buffer[box.payloadStart];
  if (buffer[box.payloadStart + 1] !== 0 || buffer[box.payloadStart + 2] !== 0
      || buffer[box.payloadStart + 3] !== 0) {
    throw unsupported();
  }
  let timescale;
  let duration;
  if (version === 0) {
    timescale = buffer.readUInt32BE(box.payloadStart + 12);
    const rawDuration = buffer.readUInt32BE(box.payloadStart + 16);
    if (rawDuration === 0xffffffff) throw unsupported();
    duration = BigInt(rawDuration);
  } else if (version === 1) {
    if (payloadBytes < 32) throw unsupported();
    timescale = buffer.readUInt32BE(box.payloadStart + 20);
    duration = buffer.readBigUInt64BE(box.payloadStart + 24);
    if (duration === 0xffffffffffffffffn) throw unsupported();
  } else {
    throw unsupported();
  }
  if (!timescale || duration <= 0n) throw unsupported();
  const durationMs = (duration * 1_000n + BigInt(timescale) - 1n) / BigInt(timescale);
  if (durationMs <= 0n || durationMs > BigInt(Number.MAX_SAFE_INTEGER)) throw unsupported();
  return { timescale, durationMs: Number(durationMs) };
}

function parseSampleTimeline(buffer, stts, timescale) {
  const payloadBytes = stts.end - stts.payloadStart;
  if (payloadBytes < 8 || buffer[stts.payloadStart] !== 0
      || buffer[stts.payloadStart + 1] !== 0 || buffer[stts.payloadStart + 2] !== 0
      || buffer[stts.payloadStart + 3] !== 0) {
    throw unsupported();
  }
  const entryCount = buffer.readUInt32BE(stts.payloadStart + 4);
  if (!entryCount || entryCount > MAX_TIMING_ENTRIES || payloadBytes !== 8 + entryCount * 8) {
    throw unsupported();
  }
  let duration = 0n;
  let totalSamples = 0n;
  let cursor = stts.payloadStart + 8;
  for (let index = 0; index < entryCount; index += 1) {
    const sampleCount = buffer.readUInt32BE(cursor);
    const sampleDelta = buffer.readUInt32BE(cursor + 4);
    if (!sampleCount || !sampleDelta) throw unsupported();
    duration += BigInt(sampleCount) * BigInt(sampleDelta);
    totalSamples += BigInt(sampleCount);
    cursor += 8;
  }
  const durationMs = (duration * 1_000n + BigInt(timescale) - 1n) / BigInt(timescale);
  if (durationMs <= 0n || durationMs > BigInt(Number.MAX_SAFE_INTEGER)) throw unsupported();
  if (totalSamples > BigInt(MAX_MEDIA_SAMPLES)) throw unsupported();
  return { durationMs: Number(durationMs), sampleCount: Number(totalSamples) };
}

function parseSampleSizes(buffer, stsz) {
  const payloadBytes = stsz.end - stsz.payloadStart;
  if (payloadBytes < 12 || buffer[stsz.payloadStart] !== 0
      || buffer[stsz.payloadStart + 1] !== 0 || buffer[stsz.payloadStart + 2] !== 0
      || buffer[stsz.payloadStart + 3] !== 0) {
    throw unsupported();
  }
  const constantSize = buffer.readUInt32BE(stsz.payloadStart + 4);
  const sampleCount = buffer.readUInt32BE(stsz.payloadStart + 8);
  if (!sampleCount || sampleCount > MAX_MEDIA_SAMPLES) throw unsupported();
  if (constantSize) {
    if (payloadBytes !== 12) throw unsupported();
    return { sampleCount, constantSize, sizes: null, firstSize: constantSize };
  }
  if (payloadBytes !== 12 + sampleCount * 4) throw unsupported();
  let firstSize = 0;
  const sizes = [];
  let cursor = stsz.payloadStart + 12;
  for (let index = 0; index < sampleCount; index += 1) {
    const size = buffer.readUInt32BE(cursor);
    if (!size) throw unsupported();
    if (index === 0) firstSize = size;
    sizes.push(size);
    cursor += 4;
  }
  return { sampleCount, constantSize: 0, sizes, firstSize };
}

function parseChunkOffsets(buffer, stco, co64) {
  if (!!stco === !!co64) throw unsupported();
  const box = stco || co64;
  const entryBytes = stco ? 4 : 8;
  const payloadBytes = box.end - box.payloadStart;
  if (payloadBytes < 8 || buffer[box.payloadStart] !== 0
      || buffer[box.payloadStart + 1] !== 0 || buffer[box.payloadStart + 2] !== 0
      || buffer[box.payloadStart + 3] !== 0) {
    throw unsupported();
  }
  const entryCount = buffer.readUInt32BE(box.payloadStart + 4);
  if (!entryCount || entryCount > MAX_CHUNKS || payloadBytes !== 8 + entryCount * entryBytes) {
    throw unsupported();
  }
  const offsets = [];
  let cursor = box.payloadStart + 8;
  for (let index = 0; index < entryCount; index += 1) {
    const offset = stco ? buffer.readUInt32BE(cursor) : uint64(buffer, cursor);
    if (!Number.isSafeInteger(offset) || offset < 0) throw unsupported();
    offsets.push(offset);
    cursor += entryBytes;
  }
  return offsets;
}

function parseSampleToChunk(buffer, stsc, offsets, sizes, descriptionCount, mdats) {
  const payloadBytes = stsc.end - stsc.payloadStart;
  if (payloadBytes < 20 || buffer[stsc.payloadStart] !== 0
      || buffer[stsc.payloadStart + 1] !== 0 || buffer[stsc.payloadStart + 2] !== 0
      || buffer[stsc.payloadStart + 3] !== 0) {
    throw unsupported();
  }
  const entryCount = buffer.readUInt32BE(stsc.payloadStart + 4);
  if (!entryCount || entryCount > MAX_CHUNKS || payloadBytes !== 8 + entryCount * 12) {
    throw unsupported();
  }
  const entries = [];
  let cursor = stsc.payloadStart + 8;
  for (let index = 0; index < entryCount; index += 1) {
    const firstChunk = buffer.readUInt32BE(cursor);
    const samplesPerChunk = buffer.readUInt32BE(cursor + 4);
    const descriptionIndex = buffer.readUInt32BE(cursor + 8);
    if (!firstChunk || !samplesPerChunk || !descriptionIndex || descriptionIndex > descriptionCount
        || (index === 0 && firstChunk !== 1)
        || (entries.length && firstChunk <= entries.at(-1).firstChunk)) {
      throw unsupported();
    }
    entries.push({ firstChunk, samplesPerChunk, descriptionIndex });
    cursor += 12;
  }
  let sampleIndex = 0;
  let firstSample = null;
  for (let index = 0; index < entries.length; index += 1) {
    const start = entries[index].firstChunk;
    const end = index + 1 < entries.length ? entries[index + 1].firstChunk - 1 : offsets.length;
    if (start > offsets.length || end < start) throw unsupported();
    for (let chunkNumber = start; chunkNumber <= end; chunkNumber += 1) {
      let sampleOffset = offsets[chunkNumber - 1];
      const mdat = mdats.find((candidate) => (
        sampleOffset >= candidate.payloadStart && sampleOffset < candidate.end
      ));
      if (!mdat) throw unsupported();
      for (let chunkSample = 0; chunkSample < entries[index].samplesPerChunk; chunkSample += 1) {
        if (sampleIndex >= sizes.sampleCount) throw unsupported();
        const sampleSize = sizes.constantSize || sizes.sizes[sampleIndex];
        const sampleEnd = sampleOffset + sampleSize;
        if (!Number.isSafeInteger(sampleEnd) || sampleEnd > mdat.end) throw unsupported();
        if (!firstSample) {
          firstSample = {
            offset: sampleOffset,
            size: sampleSize,
            descriptionIndex: entries[index].descriptionIndex,
          };
        }
        sampleOffset = sampleEnd;
        sampleIndex += 1;
      }
    }
  }
  if (sampleIndex !== sizes.sampleCount || !firstSample) throw unsupported();
  return firstSample;
}

function firstSampleMapping(buffer, stblChildren, descriptionCount, mdats) {
  const stsz = onlyBox(stblChildren, "stsz");
  const stsc = onlyBox(stblChildren, "stsc");
  const stco = onlyBox(stblChildren, "stco", { required: false });
  const co64 = onlyBox(stblChildren, "co64", { required: false });
  const sizes = parseSampleSizes(buffer, stsz);
  const offsets = parseChunkOffsets(buffer, stco, co64);
  const firstSample = parseSampleToChunk(buffer, stsc, offsets, sizes, descriptionCount, mdats);
  return { ...firstSample, sampleCount: sizes.sampleCount };
}

class BitReader {
  constructor(buffer) {
    this.buffer = buffer;
    this.bitOffset = 0;
  }

  read(bitCount) {
    if (!Number.isSafeInteger(bitCount) || bitCount < 0 || bitCount > 32
        || this.bitOffset + bitCount > this.buffer.length * 8) {
      throw unsupported();
    }
    let value = 0;
    for (let index = 0; index < bitCount; index += 1) {
      const absolute = this.bitOffset + index;
      value = value * 2 + ((this.buffer[Math.floor(absolute / 8)] >> (7 - (absolute % 8))) & 1);
    }
    this.bitOffset += bitCount;
    return value;
  }

  unsignedExpGolomb() {
    let leadingZeros = 0;
    while (this.read(1) === 0) {
      leadingZeros += 1;
      if (leadingZeros > 30) throw unsupported();
    }
    return (2 ** leadingZeros) - 1 + (leadingZeros ? this.read(leadingZeros) : 0);
  }

  signedExpGolomb() {
    const code = this.unsignedExpGolomb();
    return code % 2 ? (code + 1) / 2 : -(code / 2);
  }

  remainingBitsAreZero() {
    while (this.bitOffset < this.buffer.length * 8) {
      if (this.read(1) !== 0) return false;
    }
    return true;
  }
}

function rbsp(nalPayload) {
  const output = [];
  let zeroCount = 0;
  for (const byte of nalPayload) {
    if (zeroCount >= 2 && byte === 0x03) {
      zeroCount = 0;
      continue;
    }
    output.push(byte);
    zeroCount = byte === 0 ? zeroCount + 1 : 0;
  }
  return Buffer.from(output);
}

function skipScalingList(reader, size) {
  let lastScale = 8;
  let nextScale = 8;
  for (let index = 0; index < size; index += 1) {
    if (nextScale !== 0) nextScale = (lastScale + reader.signedExpGolomb() + 256) % 256;
    lastScale = nextScale === 0 ? lastScale : nextScale;
  }
}

function parseSpsDimensions(sequence) {
  if (sequence.length < 5) throw unsupported();
  const profile = sequence[1];
  const reader = new BitReader(rbsp(sequence.subarray(4)));
  reader.unsignedExpGolomb(); // seq_parameter_set_id
  let chromaFormat = 1;
  let separateColourPlane = 0;
  if (profile === 100) {
    chromaFormat = reader.unsignedExpGolomb();
    if (chromaFormat !== 1) throw unsupported();
    if (chromaFormat === 3) separateColourPlane = reader.read(1);
    if (reader.unsignedExpGolomb() !== 0 || reader.unsignedExpGolomb() !== 0) throw unsupported();
    if (reader.read(1) !== 0) throw unsupported(); // qpprime_y_zero_transform_bypass_flag
    if (reader.read(1)) {
      const scalingListCount = chromaFormat === 3 ? 12 : 8;
      for (let index = 0; index < scalingListCount; index += 1) {
        if (reader.read(1)) skipScalingList(reader, index < 6 ? 16 : 64);
      }
    }
  }
  reader.unsignedExpGolomb(); // log2_max_frame_num_minus4
  const pictureOrderCountType = reader.unsignedExpGolomb();
  if (pictureOrderCountType === 0) {
    reader.unsignedExpGolomb();
  } else if (pictureOrderCountType === 1) {
    reader.read(1);
    reader.signedExpGolomb();
    reader.signedExpGolomb();
    const cycle = reader.unsignedExpGolomb();
    if (cycle > 256) throw unsupported();
    for (let index = 0; index < cycle; index += 1) reader.signedExpGolomb();
  } else if (pictureOrderCountType !== 2) {
    throw unsupported();
  }
  reader.unsignedExpGolomb(); // max_num_ref_frames
  reader.read(1); // gaps_in_frame_num_value_allowed_flag
  const pictureWidthInMbs = reader.unsignedExpGolomb() + 1;
  const pictureHeightInMapUnits = reader.unsignedExpGolomb() + 1;
  const frameMbsOnly = reader.read(1);
  // The private-derivative-v1 playback matrix is progressive only. Interlaced H.264 is
  // phase-rejected here rather than admitted structurally and refused later by
  // the isolated decoder.
  if (!frameMbsOnly) throw unsupported();
  reader.read(1); // direct_8x8_inference_flag
  let cropLeft = 0;
  let cropRight = 0;
  let cropTop = 0;
  let cropBottom = 0;
  if (reader.read(1)) {
    cropLeft = reader.unsignedExpGolomb();
    cropRight = reader.unsignedExpGolomb();
    cropTop = reader.unsignedExpGolomb();
    cropBottom = reader.unsignedExpGolomb();
  }
  const chromaArrayType = separateColourPlane ? 0 : chromaFormat;
  const cropUnitX = chromaArrayType === 0 ? 1 : chromaArrayType === 3 ? 1 : 2;
  const cropUnitY = chromaArrayType === 0
    ? 2 - frameMbsOnly
    : (chromaArrayType === 1 ? 2 : 1) * (2 - frameMbsOnly);
  const width = pictureWidthInMbs * 16 - (cropLeft + cropRight) * cropUnitX;
  const height = pictureHeightInMapUnits * 16 * (2 - frameMbsOnly)
    - (cropTop + cropBottom) * cropUnitY;
  const frameMacroblocks = pictureWidthInMbs * pictureHeightInMapUnits * (2 - frameMbsOnly);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
      || width > MAX_VIDEO_WIDTH || height > MAX_VIDEO_HEIGHT
      || frameMacroblocks > (AVC_LEVEL_MAX_FRAME_MBS.get(sequence[3]) || 0)) {
    throw unsupported();
  }
  return {
    width,
    height,
    codedWidth: pictureWidthInMbs * 16,
    codedHeight: pictureHeightInMapUnits * 16,
    frameMacroblocks,
  };
}

function validateAvcConfiguration(buffer, entry, fixedPayloadBytes, parseState, contentType) {
  const childrenStart = entry.payloadStart + fixedPayloadBytes;
  if (childrenStart >= entry.end) throw unsupported();
  const children = listSampleEntryBoxes(buffer, childrenStart, entry.end, parseState, {
    allowQuickTimeZeroPadding: contentType === "video/quicktime",
  });
  if (children.some((child) => child.type === "sinf")) throw unsupported();
  const pixelAspect = onlyBox(children, "pasp", { required: false });
  if (pixelAspect) {
    if (pixelAspect.end - pixelAspect.payloadStart !== 8) throw unsupported();
    const horizontalSpacing = buffer.readUInt32BE(pixelAspect.payloadStart);
    const verticalSpacing = buffer.readUInt32BE(pixelAspect.payloadStart + 4);
    if (!horizontalSpacing || horizontalSpacing !== verticalSpacing) throw unsupported();
  }
  const configuration = onlyBox(children, "avcC");
  const payload = buffer.subarray(configuration.payloadStart, configuration.end);
  if (payload.length < 7 || payload[0] !== 1 || !payload[1] || !payload[3]
      || (payload[4] & 0xfc) !== 0xfc || (payload[4] & 0x03) === 2
      || (payload[5] & 0xe0) !== 0xe0) {
    throw unsupported();
  }
  const profile = payload[1];
  const level = payload[3];
  if (!AVC_PROFILES.has(profile) || !AVC_LEVELS.has(level)) throw unsupported();
  let cursor = 6;
  const sequenceCount = payload[5] & 0x1f;
  if (!sequenceCount) throw unsupported();
  const sequenceDimensions = [];
  for (let index = 0; index < sequenceCount; index += 1) {
    if (cursor + 2 > payload.length) throw unsupported();
    const length = payload.readUInt16BE(cursor);
    cursor += 2;
    if (length < 4 || cursor + length > payload.length) throw unsupported();
    const sequence = payload.subarray(cursor, cursor + length);
    if ((sequence[0] & 0x1f) !== 7 || sequence[1] !== profile || sequence[3] !== level) throw unsupported();
    sequenceDimensions.push(parseSpsDimensions(sequence));
    cursor += length;
  }
  if (cursor >= payload.length) throw unsupported();
  const pictureCount = payload[cursor];
  cursor += 1;
  if (!pictureCount) throw unsupported();
  for (let index = 0; index < pictureCount; index += 1) {
    if (cursor + 2 > payload.length) throw unsupported();
    const length = payload.readUInt16BE(cursor);
    cursor += 2;
    if (!length || cursor + length > payload.length || (payload[cursor] & 0x1f) !== 8) throw unsupported();
    cursor += length;
  }
  if (sequenceDimensions.some(({ width, height, codedWidth, codedHeight, frameMacroblocks }) => (
    width !== sequenceDimensions[0].width || height !== sequenceDimensions[0].height
    || codedWidth !== sequenceDimensions[0].codedWidth
    || codedHeight !== sequenceDimensions[0].codedHeight
    || frameMacroblocks !== sequenceDimensions[0].frameMacroblocks
  ))) {
    throw unsupported();
  }
  return {
    dimensions: sequenceDimensions[0],
    nalLengthSize: (payload[4] & 0x03) + 1,
  };
}

function validateHevcConfiguration(buffer, entry, fixedPayloadBytes, parseState) {
  const childrenStart = entry.payloadStart + fixedPayloadBytes;
  if (childrenStart >= entry.end) throw unsupported();
  const children = listBoxes(buffer, childrenStart, entry.end, parseState);
  if (children.some((child) => child.type === "sinf"
      || DOLBY_VISION_CONFIGURATION_BOXES.has(child.type))) throw unsupported();
  const pixelAspect = onlyBox(children, "pasp", { required: false });
  if (pixelAspect) {
    if (pixelAspect.end - pixelAspect.payloadStart !== 8) throw unsupported();
    const horizontalSpacing = buffer.readUInt32BE(pixelAspect.payloadStart);
    const verticalSpacing = buffer.readUInt32BE(pixelAspect.payloadStart + 4);
    if (!horizontalSpacing || horizontalSpacing !== verticalSpacing) throw unsupported();
  }
  const configuration = onlyBox(children, "hvcC");
  const payload = buffer.subarray(configuration.payloadStart, configuration.end);
  if (payload.length < 23 || payload[0] !== 1) throw unsupported();
  const profile = payload[1] & 0x1f;
  const level = payload[12];
  const chromaFormat = payload[16] & 0x03;
  const lumaDepthMinus8 = payload[17] & 0x07;
  const chromaDepthMinus8 = payload[18] & 0x07;
  const lengthSize = (payload[21] & 0x03) + 1;
  const arrayCount = payload[22];
  if (!new Set([1, 2]).has(profile) || (payload[1] & 0xc0) !== 0 || level < 30 || level > 186
      || (payload[13] & 0xf0) !== 0xf0 || (payload[15] & 0xfc) !== 0xfc
      || (payload[16] & 0xfc) !== 0xfc || (payload[17] & 0xf8) !== 0xf8
      || (payload[18] & 0xf8) !== 0xf8 || chromaFormat !== 1
      || lumaDepthMinus8 !== chromaDepthMinus8 || lumaDepthMinus8 > 1
      || (profile === 1 && lumaDepthMinus8 !== 0)
      || ![1, 2, 4].includes(lengthSize) || arrayCount < 3 || arrayCount > 16) {
    throw unsupported();
  }
  let cursor = 23;
  let unitCount = 0;
  const arrayTypes = new Set();
  for (let arrayIndex = 0; arrayIndex < arrayCount; arrayIndex += 1) {
    if (cursor + 3 > payload.length) throw unsupported();
    const descriptor = payload[cursor];
    cursor += 1;
    const reserved = descriptor & 0x40;
    const nalType = descriptor & 0x3f;
    const count = payload.readUInt16BE(cursor);
    cursor += 2;
    if (reserved || !count || arrayTypes.has(nalType)
        || !new Set([32, 33, 34, 39, 40]).has(nalType)) throw unsupported();
    arrayTypes.add(nalType);
    for (let unitIndex = 0; unitIndex < count; unitIndex += 1) {
      unitCount += 1;
      if (unitCount > 64 || cursor + 2 > payload.length) throw unsupported();
      const length = payload.readUInt16BE(cursor);
      cursor += 2;
      if (length < 3 || cursor + length > payload.length) throw unsupported();
      const headerType = (payload[cursor] >> 1) & 0x3f;
      const temporalIdPlusOne = payload[cursor + 1] & 0x07;
      if ((payload[cursor] & 0x80) !== 0 || headerType !== nalType || temporalIdPlusOne === 0) {
        throw unsupported();
      }
      cursor += length;
    }
  }
  if (cursor !== payload.length || ![32, 33, 34].every((type) => arrayTypes.has(type))) throw unsupported();
  return { nalLengthSize: lengthSize };
}

function validateVideoEntry(buffer, entry, parseState, contentType) {
  const allowedEntries = contentType === "video/quicktime" ? QUICKTIME_VIDEO_SAMPLE_ENTRIES : VIDEO_SAMPLE_ENTRIES;
  if (!allowedEntries.has(entry.type) || entry.type === "avc3") throw unsupported();
  const fixedPayloadBytes = 78;
  if (entry.end - entry.payloadStart < fixedPayloadBytes) throw unsupported();
  if (buffer.readUInt16BE(entry.payloadStart + 6) !== 1) throw unsupported();
  const width = buffer.readUInt16BE(entry.payloadStart + 24);
  const height = buffer.readUInt16BE(entry.payloadStart + 26);
  if (!width || !height || width > MAX_VIDEO_WIDTH || height > MAX_VIDEO_HEIGHT) throw unsupported();
  const configuration = entry.type === "hvc1"
    ? validateHevcConfiguration(buffer, entry, fixedPayloadBytes, parseState)
    : validateAvcConfiguration(buffer, entry, fixedPayloadBytes, parseState, contentType);
  if (entry.type === "avc1"
      && (configuration.dimensions.width !== width || configuration.dimensions.height !== height)) throw unsupported();
  const codedWidth = entry.type === "hvc1" ? Math.ceil(width / 16) * 16 : configuration.dimensions.codedWidth;
  const codedHeight = entry.type === "hvc1" ? Math.ceil(height / 16) * 16 : configuration.dimensions.codedHeight;
  return {
    width,
    height,
    codedWidth,
    codedHeight,
    frameMacroblocks: (codedWidth / 16) * (codedHeight / 16),
    nalLengthSize: configuration.nalLengthSize,
    codec: entry.type === "hvc1" ? "hevc" : "h264",
  };
}

function readDescriptor(buffer, start, end) {
  if (start >= end) throw unsupported();
  const tag = buffer[start];
  let cursor = start + 1;
  let length = 0;
  let complete = false;
  for (let index = 0; index < 4; index += 1) {
    if (cursor >= end) throw unsupported();
    const value = buffer[cursor];
    cursor += 1;
    length = length * 128 + (value & 0x7f);
    if ((value & 0x80) === 0) {
      complete = true;
      break;
    }
  }
  if (!complete || length > end - cursor) throw unsupported();
  return { tag, payloadStart: cursor, end: cursor + length, next: cursor + length };
}

function descriptorList(buffer, start, end) {
  const descriptors = [];
  let cursor = start;
  while (cursor < end) {
    const descriptor = readDescriptor(buffer, cursor, end);
    descriptors.push(descriptor);
    cursor = descriptor.next;
    if (descriptors.length > 32) throw unsupported();
  }
  if (cursor !== end) throw unsupported();
  return descriptors;
}

function onlyDescriptor(descriptors, tag) {
  const matches = descriptors.filter((descriptor) => descriptor.tag === tag);
  if (matches.length !== 1) throw unsupported();
  return matches[0];
}

function readAudioObjectType(reader) {
  const shortType = reader.read(5);
  return shortType === 31 ? 32 + reader.read(6) : shortType;
}

function parseAacLcConfig(buffer) {
  const reader = new BitReader(buffer);
  if (readAudioObjectType(reader) !== 2) throw unsupported();
  const frequencyIndex = reader.read(4);
  let sampleRate;
  if (frequencyIndex === 15) {
    sampleRate = reader.read(24);
    if (sampleRate < 8_000 || sampleRate > 48_000) throw unsupported();
  } else {
    sampleRate = AAC_SAMPLE_RATES[frequencyIndex];
    if (!sampleRate || sampleRate < 8_000 || sampleRate > 48_000) throw unsupported();
  }
  const channelConfiguration = reader.read(4);
  if (channelConfiguration !== 1 && channelConfiguration !== 2) throw unsupported();

  // AAC-LC's GASpecificConfig. Restrict to the ordinary 1024-sample frame,
  // no core-coder dependency, and no extension syntax for consistent native
  // hardware decoding across iOS, Android, and browsers.
  if (reader.read(1) !== 0 || reader.read(1) !== 0 || reader.read(1) !== 0) throw unsupported();
  if (!reader.remainingBitsAreZero()) throw unsupported();
  return { sampleRate, channels: channelConfiguration };
}

function parseEsds(buffer, esds, { quickTimeWave = false } = {}) {
  if (esds.end - esds.payloadStart < 6 || buffer[esds.payloadStart] !== 0
      || buffer[esds.payloadStart + 1] !== 0 || buffer[esds.payloadStart + 2] !== 0
      || buffer[esds.payloadStart + 3] !== 0) {
    throw unsupported();
  }
  const roots = descriptorList(buffer, esds.payloadStart + 4, esds.end);
  if (quickTimeWave && roots.length !== 1) throw unsupported();
  const elementary = onlyDescriptor(roots, 0x03);
  let cursor = elementary.payloadStart;
  if (elementary.end - cursor < 3) throw unsupported();
  if (quickTimeWave && (buffer.readUInt16BE(cursor) !== 0 || buffer[cursor + 2] !== 0)) {
    throw unsupported();
  }
  cursor += 2; // ES_ID
  const flags = buffer[cursor];
  cursor += 1;
  if (flags & 0x80) cursor += 2;
  if (flags & 0x40) {
    if (cursor >= elementary.end) throw unsupported();
    const urlLength = buffer[cursor];
    cursor += 1 + urlLength;
  }
  if (flags & 0x20) cursor += 2;
  if (cursor > elementary.end) throw unsupported();

  const elementaryChildren = descriptorList(buffer, cursor, elementary.end);
  if (quickTimeWave && (elementaryChildren.length !== 2
      || elementaryChildren[0].tag !== 0x04 || elementaryChildren[1].tag !== 0x06
      || elementaryChildren[1].end - elementaryChildren[1].payloadStart !== 1
      || buffer[elementaryChildren[1].payloadStart] !== 2)) {
    throw unsupported();
  }
  const decoder = onlyDescriptor(elementaryChildren, 0x04);
  if (decoder.end - decoder.payloadStart < 13) throw unsupported();
  const objectType = buffer[decoder.payloadStart];
  const streamFlags = buffer[decoder.payloadStart + 1];
  const streamType = (streamFlags >> 2) & 0x3f;
  const descriptorFlags = streamFlags & 0x03;
  if (objectType !== 0x40 || streamType !== 5
      || (quickTimeWave ? descriptorFlags !== 0 : descriptorFlags !== 1)) throw unsupported();
  const decoderChildren = descriptorList(buffer, decoder.payloadStart + 13, decoder.end);
  if (quickTimeWave && (decoderChildren.length !== 1 || decoderChildren[0].tag !== 0x05)) {
    throw unsupported();
  }
  const specific = onlyDescriptor(decoderChildren, 0x05);
  return parseAacLcConfig(buffer.subarray(specific.payloadStart, specific.end));
}

function validateAudioEntry(buffer, entry, parseState, contentType) {
  if (!AUDIO_SAMPLE_ENTRIES.has(entry.type)) throw unsupported();
  if (entry.end - entry.payloadStart < 28) throw unsupported();
  const version = buffer.readUInt16BE(entry.payloadStart + 8);
  const quickTimeV1 = contentType === "video/quicktime" && version === 1;
  const fixedPayloadBytes = quickTimeV1 ? 44 : 28;
  if ((!quickTimeV1 && version !== 0)
      || entry.end - entry.payloadStart < fixedPayloadBytes
      || buffer.readUInt16BE(entry.payloadStart + 6) !== 1) throw unsupported();
  const channels = buffer.readUInt16BE(entry.payloadStart + 16);
  const sampleSize = buffer.readUInt16BE(entry.payloadStart + 18);
  const fixedSampleRate = buffer.readUInt32BE(entry.payloadStart + 24);
  if ((channels !== 1 && channels !== 2) || sampleSize !== 16 || fixedSampleRate % 65_536 !== 0) {
    throw unsupported();
  }
  const sampleRate = fixedSampleRate / 65_536;
  if (quickTimeV1 && (buffer.readUInt16BE(entry.payloadStart + 10) !== 0
      || entry.headerSize !== 8 || entry.size !== 143 || entry.extendsToEnd
      || buffer.subarray(entry.payloadStart, entry.payloadStart + 6).some((byte) => byte !== 0)
      || buffer.readUInt32BE(entry.payloadStart + 12) !== 0
      || channels !== 2
      || buffer.readInt16BE(entry.payloadStart + 20) !== -2
      || buffer.readUInt16BE(entry.payloadStart + 22) !== 0
      || buffer.readUInt32BE(entry.payloadStart + 28) !== 1_024
      || buffer.readUInt32BE(entry.payloadStart + 32) !== 1
      || buffer.readUInt32BE(entry.payloadStart + 36) !== 2
      || buffer.readUInt32BE(entry.payloadStart + 40) !== 2)) {
    throw unsupported();
  }
  const childrenStart = entry.payloadStart + fixedPayloadBytes;
  if (childrenStart >= entry.end) throw unsupported();
  const children = listBoxes(buffer, childrenStart, entry.end, parseState);
  if (children.some((child) => child.type === "sinf")) throw unsupported();
  let esds;
  if (quickTimeV1) {
    if (children.length !== 1 || children[0].type !== "wave"
        || children[0].headerSize !== 8 || children[0].size !== 91
        || children[0].extendsToEnd) throw unsupported();
    const waveChildren = listBoxes(buffer, children[0].payloadStart, children[0].end, parseState);
    if (waveChildren.length !== 4
        || waveChildren[0].type !== "frma"
        || waveChildren[0].headerSize !== 8 || waveChildren[0].size !== 12
        || waveChildren[0].extendsToEnd
        || fourCc(buffer, waveChildren[0].payloadStart) !== "mp4a"
        || waveChildren[1].type !== "mp4a"
        || waveChildren[1].headerSize !== 8 || waveChildren[1].size !== 12
        || waveChildren[1].extendsToEnd
        || buffer.readUInt32BE(waveChildren[1].payloadStart) !== 0
        || waveChildren[2].type !== "esds" || waveChildren[2].headerSize !== 8
        || waveChildren[2].size !== 51 || waveChildren[2].extendsToEnd
        || waveChildren[3].type !== "\0\0\0\0"
        || waveChildren[3].headerSize !== 8 || waveChildren[3].size !== 8
        || waveChildren[3].extendsToEnd
        || waveChildren[3].end !== waveChildren[3].payloadStart) {
      throw unsupported();
    }
    esds = waveChildren[2];
  } else {
    esds = onlyBox(children, "esds");
  }
  const config = parseEsds(buffer, esds, { quickTimeWave: quickTimeV1 });
  if (config.channels !== channels || config.sampleRate !== sampleRate) throw unsupported();
}

function parseSampleDescriptions(buffer, stsd, handlerType, parseState, contentType) {
  const payloadBytes = stsd.end - stsd.payloadStart;
  if (payloadBytes < 8 || buffer[stsd.payloadStart] !== 0
      || buffer[stsd.payloadStart + 1] !== 0 || buffer[stsd.payloadStart + 2] !== 0
      || buffer[stsd.payloadStart + 3] !== 0) {
    throw unsupported();
  }
  const entryCount = buffer.readUInt32BE(stsd.payloadStart + 4);
  if (!entryCount || entryCount > MAX_SAMPLE_ENTRIES) throw unsupported();
  const entries = [];
  let cursor = stsd.payloadStart + 8;
  for (let index = 0; index < entryCount; index += 1) {
    const entry = parseBoxHeader(buffer, cursor, stsd.end, parseState);
    if (entry.extendsToEnd) throw unsupported();
    entries.push(entry);
    cursor = entry.end;
  }
  if (cursor !== stsd.end) throw unsupported();

  if (handlerType === "vide") {
    const descriptions = entries.map((entry) => validateVideoEntry(buffer, entry, parseState, contentType));
    if (descriptions.some(({ width, height, codedWidth, codedHeight, frameMacroblocks, nalLengthSize, codec }) => (
      width !== descriptions[0].width || height !== descriptions[0].height
      || codedWidth !== descriptions[0].codedWidth || codedHeight !== descriptions[0].codedHeight
      || frameMacroblocks !== descriptions[0].frameMacroblocks
      || nalLengthSize !== descriptions[0].nalLengthSize
      || codec !== descriptions[0].codec
    ))) {
      throw unsupported();
    }
    return {
      descriptionCount: entries.length,
      dimensions: {
        width: descriptions[0].width,
        height: descriptions[0].height,
        codedWidth: descriptions[0].codedWidth,
        codedHeight: descriptions[0].codedHeight,
        frameMacroblocks: descriptions[0].frameMacroblocks,
      },
      sampleConfigs: descriptions.map(({ nalLengthSize, codec }) => ({ nalLengthSize, codec })),
    };
  }
  if (handlerType === "soun") {
    entries.forEach((entry) => validateAudioEntry(buffer, entry, parseState, contentType));
  }
  return { descriptionCount: entries.length, dimensions: null, sampleConfigs: [] };
}

function parseTrack(buffer, trak, parseState, mdats, contentType) {
  const trakChildren = listBoxes(buffer, trak.payloadStart, trak.end, parseState);
  const mdia = onlyBox(trakChildren, "mdia");
  const mdiaChildren = listBoxes(buffer, mdia.payloadStart, mdia.end, parseState);
  const hdlr = onlyBox(mdiaChildren, "hdlr");
  if (hdlr.end - hdlr.payloadStart < 12 || buffer[hdlr.payloadStart] !== 0
      || buffer[hdlr.payloadStart + 1] !== 0 || buffer[hdlr.payloadStart + 2] !== 0
      || buffer[hdlr.payloadStart + 3] !== 0) {
    throw unsupported();
  }
  const handlerType = fourCc(buffer, hdlr.payloadStart + 8);
  if (handlerType !== "vide" && handlerType !== "soun") return { handlerType, dimensions: null };

  const mdhd = onlyBox(mdiaChildren, "mdhd");
  const mediaDuration = parseMovieDuration(buffer, mdhd);

  const minf = onlyBox(mdiaChildren, "minf");
  const minfChildren = listBoxes(buffer, minf.payloadStart, minf.end, parseState);
  const stbl = onlyBox(minfChildren, "stbl");
  const stblChildren = listBoxes(buffer, stbl.payloadStart, stbl.end, parseState);
  const stsd = onlyBox(stblChildren, "stsd");
  const stts = onlyBox(stblChildren, "stts");
  const descriptions = parseSampleDescriptions(buffer, stsd, handlerType, parseState, contentType);
  const firstSample = firstSampleMapping(buffer, stblChildren, descriptions.descriptionCount, mdats);
  const sampleTimeline = parseSampleTimeline(buffer, stts, mediaDuration.timescale);
  if (sampleTimeline.sampleCount !== firstSample.sampleCount) throw unsupported();
  return {
    handlerType,
    dimensions: descriptions.dimensions,
    durationMs: Math.max(mediaDuration.durationMs, sampleTimeline.durationMs),
    sampleCount: sampleTimeline.sampleCount,
    firstSample: handlerType === "vide" ? {
      ...firstSample,
      ...descriptions.sampleConfigs[firstSample.descriptionIndex - 1],
    } : firstSample,
  };
}

function parseMoov(buffer, parseState, mdats, contentType) {
  const moov = parseBoxHeader(buffer, 0, buffer.length, parseState);
  if (moov.type !== "moov" || moov.end !== buffer.length || moov.extendsToEnd) throw unsupported();
  const children = listBoxes(buffer, moov.payloadStart, moov.end, parseState);
  const mvhd = onlyBox(children, "mvhd");
  const movieDuration = parseMovieDuration(buffer, mvhd);
  const tracks = children.filter((box) => box.type === "trak");
  if (!tracks.length) throw unsupported();
  const parsedTracks = tracks.map((track) => parseTrack(buffer, track, parseState, mdats, contentType));
  const videoTracks = parsedTracks.filter(({ handlerType }) => handlerType === "vide");
  const audioTracks = parsedTracks.filter(({ handlerType }) => handlerType === "soun");
  const unknownTracks = parsedTracks.filter(({ handlerType }) => handlerType !== "vide" && handlerType !== "soun");
  const discardedQuickTimeTracks = contentType === "video/quicktime"
    && unknownTracks.length <= VIDEO_VERIFIER_MAX_DISCARDED_QUICKTIME_TRACKS
    && unknownTracks.every(({ handlerType }) => QUICKTIME_DISCARDED_TRACK_HANDLERS.has(handlerType));
  if (videoTracks.length !== 1 || audioTracks.length > 1
      || (unknownTracks.length && !discardedQuickTimeTracks)) {
    throw unsupported();
  }
  const video = videoTracks[0];
  const durationMs = Math.max(movieDuration.durationMs,
    ...parsedTracks.map(({ durationMs: trackDuration = 0 }) => trackDuration));
  if (durationMs > MAX_CLIP_DURATION_MS) throw unsupported();
  const sampleLimit = Math.floor((durationMs * MAX_VIDEO_SAMPLES_PER_SECOND) / 1_000) + MAX_VIDEO_SAMPLE_SLACK;
  const codedPixelSamples = BigInt(video.dimensions.frameMacroblocks) * 256n * BigInt(video.sampleCount);
  if (video.sampleCount > sampleLimit || codedPixelSamples > MAX_VIDEO_CODED_PIXEL_SAMPLES) throw unsupported();
  return {
    durationMs,
    width: video.dimensions.width,
    height: video.dimensions.height,
    codedWidth: video.dimensions.codedWidth,
    codedHeight: video.dimensions.codedHeight,
    sampleCount: video.sampleCount,
    videoSamples: [video.firstSample],
    ...(contentType === "video/quicktime" ? {
      sourceContainer: "quicktime",
      sourceCodec: video.firstSample.codec,
    } : video.firstSample.codec === "hevc" ? {
      sourceCodec: "hevc",
    } : {}),
  };
}

async function scanTopLevel(state) {
  let offset = 0;
  let boxes = 0;
  let ftyp = null;
  let moov = null;
  const mdats = [];
  while (offset < state.expectedBytes) {
    ensureWithinDeadline(state);
    boxes += 1;
    if (boxes > MAX_TOP_LEVEL_BOXES || state.expectedBytes - offset < 8) throw unsupported();
    const headerBytes = Math.min(16, state.expectedBytes - offset);
    const header = await getRange(state, offset, offset + headerBytes - 1);

    // The local buffer contains only the header. Resolve the declared size
    // against the complete object instead of treating the range end as the box
    // boundary.
    const size32 = header.readUInt32BE(0);
    const type = fourCc(header, 4);
    let headerSize = type === "uuid" ? 24 : 8;
    let size;
    if (size32 === 0) {
      size = state.expectedBytes - offset;
    } else if (size32 === 1) {
      if (header.length < 16) throw unsupported();
      size = uint64(header, 8);
      headerSize += 8;
    } else {
      size = size32;
    }
    if (size < headerSize || size > state.expectedBytes - offset) throw unsupported();
    const descriptor = {
      type,
      start: offset,
      end: offset + size,
      size,
      headerSize,
      payloadStart: offset + headerSize,
    };
    if (STREAMING_ONLY_BOXES.has(type)) throw unsupported();
    if (type === "ftyp") {
      if (ftyp) throw unsupported();
      if (size > MAX_FTYP_BYTES) throw unsupported();
      ftyp = descriptor;
    }
    if (type === "moov") {
      if (moov) throw unsupported();
      if (size > MAX_MOOV_BYTES) throw unsupported();
      moov = descriptor;
    }
    if (type === "mdat") mdats.push(descriptor);
    offset += size;
  }
  if (offset !== state.expectedBytes || !ftyp || !moov
      || !mdats.length || mdats.every((mdat) => mdat.end <= mdat.payloadStart)) {
    throw unsupported();
  }
  return { ftyp, moov, mdats };
}

function readNalLength(buffer, offset, lengthSize) {
  let value = 0;
  for (let index = 0; index < lengthSize; index += 1) value = value * 256 + buffer[offset + index];
  return value;
}

async function verifyFirstAvcSample(state, sample) {
  if (!sample || !Number.isSafeInteger(sample.size) || sample.size < 1
      || sample.size > MAX_FIRST_SAMPLE_BYTES || ![1, 2, 4].includes(sample.nalLengthSize)) {
    throw unsupported();
  }
  const bytes = await getRange(state, sample.offset, sample.offset + sample.size - 1);
  let cursor = 0;
  let units = 0;
  let hasIdr = false;
  while (cursor < bytes.length) {
    units += 1;
    if (units > 4_096 || cursor + sample.nalLengthSize > bytes.length) throw unsupported();
    const length = readNalLength(bytes, cursor, sample.nalLengthSize);
    cursor += sample.nalLengthSize;
    if (!length || cursor + length > bytes.length) throw unsupported();
    const header = bytes[cursor];
    const type = header & 0x1f;
    if ((header & 0x80) !== 0 || type < 1 || type > 23) throw unsupported();
    if (type === 5) {
      if (length < 2 || (header & 0x60) === 0) throw unsupported();
      const slice = new BitReader(rbsp(bytes.subarray(cursor + 1, cursor + length)));
      if (slice.unsignedExpGolomb() !== 0 || slice.unsignedExpGolomb() % 5 !== 2
          || slice.unsignedExpGolomb() > 255) {
        throw unsupported();
      }
      hasIdr = true;
    }
    cursor += length;
  }
  if (cursor !== bytes.length || !hasIdr) throw unsupported();
}

async function verifyFirstHevcSample(state, sample) {
  if (!sample || !Number.isSafeInteger(sample.size) || sample.size < 1
      || sample.size > MAX_FIRST_SAMPLE_BYTES || ![1, 2, 4].includes(sample.nalLengthSize)) {
    throw unsupported();
  }
  const bytes = await getRange(state, sample.offset, sample.offset + sample.size - 1);
  let cursor = 0;
  let units = 0;
  let hasRandomAccessPicture = false;
  while (cursor < bytes.length) {
    units += 1;
    if (units > 4_096 || cursor + sample.nalLengthSize > bytes.length) throw unsupported();
    const length = readNalLength(bytes, cursor, sample.nalLengthSize);
    cursor += sample.nalLengthSize;
    if (length < 3 || cursor + length > bytes.length) throw unsupported();
    const forbiddenZero = bytes[cursor] & 0x80;
    const nalType = (bytes[cursor] >> 1) & 0x3f;
    const temporalIdPlusOne = bytes[cursor + 1] & 0x07;
    if (forbiddenZero || temporalIdPlusOne === 0) throw unsupported();
    if (nalType >= 16 && nalType <= 21) hasRandomAccessPicture = true;
    cursor += length;
  }
  if (cursor !== bytes.length || !hasRandomAccessPicture) throw unsupported();
}

async function verifyFirstVideoSample(state, sample) {
  if (sample?.codec === "hevc") return verifyFirstHevcSample(state, sample);
  if (sample?.codec === "h264") return verifyFirstAvcSample(state, sample);
  throw unsupported();
}

async function runStructuralProbe(initialState) {
  const state = {
    ...initialState,
    requests: 0,
    responseBytes: 0,
    deadline: Date.now() + MAX_WALL_MS,
  };
  const { ftyp, moov, mdats } = await scanTopLevel(state);
  const ftypBytes = await getRange(state, ftyp.start, ftyp.end - 1);
  const moovBytes = await getRange(state, moov.start, moov.end - 1);
  const parseState = { boxes: 0 };
  try {
    validateFtyp(ftypBytes, parseState, state.contentType);
    const parsed = parseMoov(moovBytes, parseState, mdats, state.contentType);
    for (const sample of parsed.videoSamples) await verifyFirstVideoSample(state, sample);
    const { videoSamples, ...projection } = parsed;
    void videoSamples;
    return projection;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw unsupported();
  }
}

/**
 * Inspect a stored MP4 using authenticated, exact byte ranges.
 *
 * The optional `ifMatch` value should be the strong ETag observed by the
 * caller's HEAD request. When supplied, it is signed and sent on every GET so
 * the probe cannot combine boxes from different object generations.
 *
 * This is deliberately a bounded structural preflight, not a software decode.
 * Its result must never by itself set codec_status=verified or make a clip
 * public: slice payloads and later access units can still fail to decode.
 * Distinct probes are globally bounded before their first storage request;
 * callers for the same exact object generation share the in-flight proof.
 */
export async function verifyMp4Compatibility({
  objectKey,
  expectedBytes,
  contentType = "video/mp4",
  ifMatch,
  env = process.env,
  fetchImpl = globalThis.fetch,
  signal,
  storageScope = "public",
} = {}) {
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 16) throw unsupported();
  if (typeof fetchImpl !== "function") throw unavailable();
  if (signal?.aborted) throw signal.reason || new DOMException("Aborted", "AbortError");

  let config;
  try {
    config = getMediaConfig(env);
  } catch (error) {
    if (error instanceof ApiError && error.status === 503) throw error;
    throw unavailable();
  }
  if (!config.configured) throw unavailable();
  const key = normalizedObjectKey(objectKey);
  const normalizedContentType = normalizedSourceContentType(contentType, key);
  const etag = normalizedIfMatch(ifMatch);
  const normalizedStorageScope = storageScope === "private" ? "private" : "public";
  const state = {
    config,
    objectUrl: endpointObjectUrl({
      ...config,
      bucket: normalizedStorageScope === "private" ? config.sourceBucket : config.bucket,
    }, key),
    expectedBytes,
    contentType: normalizedContentType,
    ifMatch: etag,
    fetchImpl,
    storageScope: normalizedStorageScope,
  };
  const identity = structuralProbeIdentity(state);
  let current = activeStructuralProbes.get(identity);
  // The last caller can cancel the shared job one microtask before its finally
  // handler removes it. Do not make an immediate retry inherit that already-
  // aborted generation; the old cleanup is identity-fenced below.
  if (current?.controller.signal.aborted && !current.settled && current.waiters === 0) {
    if (activeStructuralProbes.get(identity) === current) activeStructuralProbes.delete(identity);
    current = null;
  }
  if (current) return waitForStructuralProbe(current, signal);
  if (activeStructuralProbes.size >= MAX_CONCURRENT_MP4_STRUCTURAL_PROBES) throw structuralProbeBusy();

  const controller = new AbortController();
  const job = {
    controller,
    promise: null,
    settled: false,
    waiters: 0,
  };
  activeStructuralProbes.set(identity, job);
  job.promise = Promise.resolve()
    .then(() => runStructuralProbe({ ...state, signal: controller.signal }))
    .finally(() => {
      job.settled = true;
      if (activeStructuralProbes.get(identity) === job) activeStructuralProbes.delete(identity);
    });
  return waitForStructuralProbe(job, signal);
}
