import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";

import {
  MEDIA_VIDEO_DELIVERY_MAX_FRAME_RATE,
  MEDIA_VIDEO_MAX_DURATION_MS,
  MEDIA_VIDEO_MAX_FRAME_RATE,
  MEDIA_VIDEO_MAX_SAMPLES,
  MEDIA_VIDEO_SOURCE_MAX_BYTES,
  MEDIA_VIDEO_SOURCE_MAX_LONG_EDGE,
  MEDIA_VIDEO_SOURCE_MAX_SHORT_EDGE,
} from "../src/domain/mediaUploadPolicy.mjs";

import { PUBLIC_MEDIA_CACHE_CONTROL } from "./mediaDeliveryPolicy.js";

import {
  VIDEO_VERIFIER_MAX_DISCARDED_QUICKTIME_TRACKS,
  VIDEO_VERIFIER_PIPELINE_VERSION,
  VIDEO_VERIFIER_PROTOCOL_VERSION,
  VIDEO_VERIFIER_SOURCE_ADMISSION_REVISION,
  VIDEO_VERIFIER_SOURCE_CODECS,
  VIDEO_VERIFIER_SOURCE_CONTENT_TYPES,
  VIDEO_VERIFIER_UNIVERSAL_ADMISSION,
  VIDEO_VERIFIER_UNIVERSAL_SOURCE_TYPES,
  signVideoVerifierResponse,
  videoVerifierSourceExtension,
  videoVerifierUniversalPosterTimeMs,
  verifyVideoVerifierRequest,
} from "./videoVerifierProtocol.js";

const REQUEST_MAX_BYTES = 16 * 1024;
const VIDEO_MAX_BYTES = MEDIA_VIDEO_SOURCE_MAX_BYTES;
const VIDEO_MAX_DURATION_MS = MEDIA_VIDEO_MAX_DURATION_MS;
const VIDEO_MAX_EDGE = MEDIA_VIDEO_SOURCE_MAX_LONG_EDGE;
const VIDEO_MAX_SAMPLES = MEDIA_VIDEO_MAX_SAMPLES;
const DELIVERY_MAX_WIDTH = 1_920;
const DELIVERY_MAX_HEIGHT = 1_080;
const DELIVERY_VIDEO_MAX_RATE = 11_000_000;
const DELIVERY_AUDIO_RATE = 160_000;
const DELIVERY_VBV_SECONDS = 2;
// Keep mux tables, encoder overshoot/padding and other container overhead out
// of the elementary-stream allowance. The final on-disk byte guard remains
// authoritative; an FFmpeg rate setting is not a substitute for that check.
const DELIVERY_STREAM_BUDGET_BYTES = Math.floor(VIDEO_MAX_BYTES * 0.95) - 1_048_576;
const VIDEO_MAX_CODED_PIXEL_SAMPLES = 120n * 68n * 256n * BigInt(MEDIA_VIDEO_MAX_SAMPLES);
const POSTER_MAX_BYTES = 1_500_000;
const POSTER_MAX_EDGE = 1_280;
// The control plane owns a finite 16-minute envelope. Keep the worker inside it
// while allowing the bounded transcode to finish on the production instance.
const JOB_TIMEOUT_MS = 15 * 60_000;
const COMMAND_OUTPUT_MAX_BYTES = 64 * 1024;
const STDERR_TAIL_BYTES = 8 * 1024;
const HEALTH_FRESH_MS = 60_000;
const NONCE_TTL_MS = 2 * 60_000;
const NONCE_CACHE_MAX = 2_048;
const SOURCE_OBJECT_KEY = /^users\/[A-Za-z0-9_-]{1,128}\/post\/[A-Za-z0-9_-]{1,240}\.(?:mp4|mov)$/;
const OUTPUT_OBJECT_KEY = /^users\/[A-Za-z0-9_-]{1,128}\/post\/[A-Za-z0-9_-]{1,240}\.mp4$/;
const SOURCE_CONTENT_TYPES = new Set(VIDEO_VERIFIER_SOURCE_CONTENT_TYPES);
const UNIVERSAL_SOURCE_TYPES = new Set(VIDEO_VERIFIER_UNIVERSAL_SOURCE_TYPES);
const UNIVERSAL_SOURCE_OBJECT_KEY = /^users\/[A-Za-z0-9_-]{1,128}\/post\/[A-Za-z0-9_-]{1,240}\.[a-z0-9]{2,4}$/;
// A universal clip is always read with the demuxer its container calls for,
// never by FFmpeg's format guessing. Playlist and concat formats that can refer
// to other files are therefore unreachable, on top of the file-only protocol
// whitelist and an FFmpeg built without networking.
const UNIVERSAL_DEMUXERS = Object.freeze({
  "video/mp4": "mov",
  "video/quicktime": "mov",
  "video/x-m4v": "mov",
  "video/3gpp": "mov",
  "video/3gpp2": "mov",
  "video/webm": "matroska",
  "video/x-matroska": "matroska",
  "video/ogg": "ogg",
  "video/x-msvideo": "avi",
  "video/mpeg": "mpeg",
  "video/mp2t": "mpegts",
  "video/x-ms-wmv": "asf",
  "video/x-flv": "flv",
});
// Decoders this FFmpeg build has in software. A clip needs one of these video
// streams; other streams (cover art, subtitles, timecode, unknown data) are
// left behind. AV1 is absent because software AV1 needs libdav1d.
const UNIVERSAL_VIDEO_CODECS = new Set([
  "h264", "hevc", "vp8", "vp9", "mpeg4", "mpeg2video", "mpeg1video", "h263", "h263p",
  "msmpeg4v1", "msmpeg4v2", "msmpeg4v3", "wmv1", "wmv2", "wmv3", "vc1", "theora", "flv1",
  "vp6", "vp6f", "vp6a", "prores", "mjpeg", "dvvideo", "cinepak", "svq3",
]);
const UNIVERSAL_AUDIO_CODECS = new Set([
  "aac", "mp3", "mp2", "mp1", "opus", "vorbis", "ac3", "eac3", "flac", "alac", "dts",
  "pcm_s16le", "pcm_s16be", "pcm_s24le", "pcm_s24be", "pcm_s32le", "pcm_s32be",
  "pcm_f32le", "pcm_f32be", "pcm_u8", "pcm_mulaw", "pcm_alaw",
  "wmav1", "wmav2", "wmapro", "amr_nb", "amr_wb", "adpcm_ima_qt", "adpcm_ima_wav", "adpcm_ms",
  "nellymoser", "speex",
]);
// Used when a variable-frame-rate source reports no believable rate.
const UNIVERSAL_DEFAULT_FRAME_RATE = 30;
const STRONG_ETAG = /^"[\x21\x23-\x7e]{1,200}"$/u;
const SHA256 = /^[a-f0-9]{64}$/;
const FORBIDDEN_RENDER_PORTS = new Set([10_000, 18_012, 18_013, 19_099]);
const ISO_MP4_MAJOR_BRANDS = new Set(["isom", "mp41", "mp42"]);
const ISO_MP4_COMPATIBLE_BRANDS = new Set(["isom", "iso2", "iso3", "iso4", "iso5", "iso6", "avc1", "hvc1", "mp41", "mp42"]);
const QUICKTIME_MAJOR_BRAND = "qt  ";
const QUICKTIME_COMPATIBLE_BRANDS = new Set([QUICKTIME_MAJOR_BRAND]);

function serviceError(code, message, { status = 422, cause } = {}) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  error.status = status;
  return error;
}

function boundedInteger(value, { min, max, label }) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw serviceError("invalid_request", `${label} is invalid.`);
  }
  return number;
}

function cleanExecutable(value, fallback) {
  const executable = String(value || fallback).trim();
  return /^[A-Za-z0-9._/-]{1,240}$/.test(executable) ? executable : null;
}

function checkedStorageBase(value) {
  let url;
  try { url = new URL(String(value || "")); }
  catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
  return url;
}

export function getVideoVerifierServiceConfig(env = process.env) {
  const secret = String(env?.PIT_VIDEO_VERIFIER_SECRET || "");
  const sourceStorageBase = checkedStorageBase(env?.PIT_VIDEO_SOURCE_ORIGIN);
  const sourceBucket = String(env?.PIT_VIDEO_SOURCE_BUCKET || "").trim();
  const outputStorageBase = checkedStorageBase(env?.PIT_VIDEO_OUTPUT_ORIGIN || env?.MEDIA_ENDPOINT);
  const outputBucket = String(env?.PIT_VIDEO_OUTPUT_BUCKET || env?.MEDIA_BUCKET || "").trim();
  const ffmpeg = cleanExecutable(env?.PIT_FFMPEG_PATH, "ffmpeg");
  const ffprobe = cleanExecutable(env?.PIT_FFPROBE_PATH, "ffprobe");
  const port = Number(env?.PORT || 10_001);
  const configured = Buffer.byteLength(secret, "utf8") >= 32
    && Buffer.byteLength(secret, "utf8") <= 1_024
    && !!sourceStorageBase
    && !!outputStorageBase
    && /^[A-Za-z0-9._-]{3,255}$/.test(sourceBucket)
    && /^[A-Za-z0-9._-]{3,255}$/.test(outputBucket)
    && sourceBucket !== outputBucket
    && !!ffmpeg
    && !!ffprobe
    && Number.isSafeInteger(port)
    && port >= 1
    && port <= 65_535
    && !FORBIDDEN_RENDER_PORTS.has(port);
  return configured
    ? { configured, secret, sourceStorageBase, sourceBucket, outputStorageBase, outputBucket, ffmpeg, ffprobe, port }
    : { configured: false, port: Number.isSafeInteger(port) ? port : 10_001 };
}

function safeChildEnvironment(directory) {
  // Never pass the HMAC secret or signed storage capability through a decoder's
  // environment. FFmpeg sees one random local file in an otherwise empty temp
  // directory and receives no application credentials.
  return {
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
    TMPDIR: directory,
  };
}

// The last few decoder lines, on one line, for the private job log.
function stderrTail(chunks) {
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text.split(/\r?\n/u).filter(Boolean).slice(-4).join(" | ").slice(-600) || "no decoder output";
}

function killProcessGroup(child) {
  if (!child?.pid) return;
  try {
    if (process.platform === "win32") child.kill("SIGKILL");
    else process.kill(-child.pid, "SIGKILL");
  } catch (error) {
    if (error?.code !== "ESRCH") child.kill?.("SIGKILL");
  }
}

export function runVerifierProcess(executable, args, {
  cwd,
  signal,
  outputLimit = COMMAND_OUTPUT_MAX_BYTES,
} = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const stdout = [];
    const stderr = [];
    let child;
    try {
      child = spawn(executable, args, {
        cwd,
        env: safeChildEnvironment(cwd),
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
        windowsHide: true,
      });
    } catch (error) {
      reject(serviceError("decoder_unavailable", "Decoder process could not start.", { status: 503, cause: error }));
      return;
    }
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(value);
    };
    let abortError = null;
    const onAbort = () => {
      abortError = serviceError("job_cancelled", "Decoder job was cancelled.", { status: 503, cause: signal?.reason });
      killProcessGroup(child);
    };
    const collect = (list, chunk, stream) => {
      const bytes = Buffer.byteLength(chunk);
      if (stream === "stdout") stdoutBytes += bytes;
      else stderrBytes += bytes;
      if (stdoutBytes > outputLimit) {
        killProcessGroup(child);
        finish(serviceError("decoder_output_invalid", "Decoder produced too much output.", { status: 503 }));
        return;
      }
      list.push(Buffer.from(chunk));
    };
    // A phone clip with a few damaged frames can make the tolerant decoder
    // print a warning per frame. Keep only the last part of that text for the
    // job log instead of failing a conversion that is otherwise working.
    const collectStderr = (chunk) => {
      stderrBytes += Buffer.byteLength(chunk);
      stderr.push(Buffer.from(chunk));
      let kept = stderr.reduce((total, part) => total + part.byteLength, 0);
      while (kept > STDERR_TAIL_BYTES && stderr.length > 1) kept -= stderr.shift().byteLength;
    };
    child.stdout.on("data", (chunk) => collect(stdout, chunk, "stdout"));
    child.stderr.on("data", collectStderr);
    child.on("error", (error) => finish(serviceError("decoder_unavailable", "Decoder process failed.", { status: 503, cause: error })));
    child.on("close", (code, closeSignal) => {
      if (abortError) {
        finish(abortError);
        return;
      }
      if (code !== 0) {
        finish(serviceError("decode_failed", "Media decode failed.", {
          status: 422,
          cause: new Error(`decoder exit=${String(code)} signal=${String(closeSignal || "none")}: ${stderrTail(stderr)}`),
        }));
        return;
      }
      finish(null, {
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function expectedObjectPath(storageBase, bucket, objectKey) {
  const encode = (part) => encodeURIComponent(part).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  const prefix = storageBase.pathname.replace(/\/+$/, "");
  return `${prefix}/${[bucket, ...objectKey.split("/")].map(encode).join("/")}`;
}

// The MP4/MOV path carries the site's bounded container proof; the worker
// re-checks it before spending its single decoder slot.
function validatedStructuralProof(payload, sourceContentType) {
  const structural = {
    width: boundedInteger(payload?.structural?.width, { min: 1, max: VIDEO_MAX_EDGE, label: "Video width" }),
    height: boundedInteger(payload?.structural?.height, { min: 1, max: VIDEO_MAX_EDGE, label: "Video height" }),
    codedWidth: boundedInteger(payload?.structural?.codedWidth, { min: 16, max: VIDEO_MAX_EDGE, label: "Coded video width" }),
    codedHeight: boundedInteger(payload?.structural?.codedHeight, { min: 16, max: VIDEO_MAX_EDGE, label: "Coded video height" }),
    sampleCount: boundedInteger(payload?.structural?.sampleCount, { min: 1, max: VIDEO_MAX_SAMPLES, label: "Video sample count" }),
    durationMs: boundedInteger(payload?.structural?.durationMs, { min: 1, max: VIDEO_MAX_DURATION_MS, label: "Video duration" }),
    sourceContainer: payload?.structural?.sourceContainer,
    sourceCodec: payload?.structural?.sourceCodec,
    sourceAdmissionRevision: payload?.structural?.sourceAdmissionRevision,
  };
  const quickTimeStructural = sourceContentType !== "video/quicktime"
    || (structural.sourceContainer === "quicktime" && new Set(["h264", "hevc"]).has(structural.sourceCodec));
  const mp4Structural = sourceContentType !== "video/mp4"
    || (structural.sourceContainer === undefined
      && (structural.sourceCodec === undefined || structural.sourceCodec === "hevc"));
  const sampleLimit = Math.floor((structural.durationMs * MEDIA_VIDEO_MAX_FRAME_RATE) / 1_000) + 2;
  const codedWork = BigInt(structural.codedWidth) * BigInt(structural.codedHeight) * BigInt(structural.sampleCount);
  if (structural.codedWidth % 16 !== 0 || structural.codedHeight % 16 !== 0
      || structural.codedWidth < structural.width || structural.codedHeight < structural.height
      || Math.min(structural.width, structural.height) > MEDIA_VIDEO_SOURCE_MAX_SHORT_EDGE
      || structural.sampleCount > sampleLimit || codedWork > VIDEO_MAX_CODED_PIXEL_SAMPLES
      || !quickTimeStructural || !mp4Structural) {
    throw serviceError("invalid_request", "Video decode-work proof is invalid.");
  }
  if (structural.sourceAdmissionRevision !== undefined
      && structural.sourceAdmissionRevision !== VIDEO_VERIFIER_SOURCE_ADMISSION_REVISION) {
    throw serviceError("incompatible_protocol", "Source admission revision is incompatible.");
  }
  return structural;
}

export function validateVideoVerifierJob(payload, config) {
  if (payload?.protocol !== VIDEO_VERIFIER_PROTOCOL_VERSION) {
    throw serviceError("incompatible_protocol", "Verifier protocol is incompatible.");
  }
  if (payload?.admission !== undefined && payload.admission !== VIDEO_VERIFIER_UNIVERSAL_ADMISSION) {
    throw serviceError("incompatible_protocol", "Source admission mode is incompatible.");
  }
  const universal = payload?.admission === VIDEO_VERIFIER_UNIVERSAL_ADMISSION;
  const object = payload?.object;
  const objectKey = String(object?.key || "");
  const sourceContentType = String(object?.contentType || "");
  const byteSize = boundedInteger(object?.byteSize, { min: 1, max: VIDEO_MAX_BYTES, label: "Object size" });
  const etag = String(object?.etag || "");
  const sourceExtension = videoVerifierSourceExtension(sourceContentType);
  const sourceIdentityValid = (universal ? UNIVERSAL_SOURCE_OBJECT_KEY : SOURCE_OBJECT_KEY).test(objectKey)
    && (universal ? UNIVERSAL_SOURCE_TYPES : SOURCE_CONTENT_TYPES).has(sourceContentType)
    && !!sourceExtension && objectKey.endsWith(`.${sourceExtension}`);
  if (!sourceIdentityValid || !STRONG_ETAG.test(etag)) {
    throw serviceError("invalid_request", "Object identity is invalid.");
  }
  let downloadUrl;
  try { downloadUrl = new URL(String(object?.downloadUrl || "")); }
  catch { throw serviceError("invalid_request", "Object capability is invalid."); }
  if (downloadUrl.protocol !== "https:"
      || downloadUrl.origin !== config.sourceStorageBase.origin
      || downloadUrl.pathname !== expectedObjectPath(config.sourceStorageBase, config.sourceBucket, objectKey)
      || downloadUrl.username
      || downloadUrl.password
      || downloadUrl.hash) {
    throw serviceError("invalid_request", "Object capability is invalid.");
  }
  const allowedQuery = new Set([
    "X-Amz-Algorithm",
    "X-Amz-Credential",
    "X-Amz-Date",
    "X-Amz-Expires",
    "X-Amz-SignedHeaders",
    "X-Amz-Signature",
  ]);
  for (const key of downloadUrl.searchParams.keys()) {
    if (!allowedQuery.has(key) || downloadUrl.searchParams.getAll(key).length !== 1) {
      throw serviceError("invalid_request", "Object capability is invalid.");
    }
  }
  if (downloadUrl.searchParams.get("X-Amz-Algorithm") !== "AWS4-HMAC-SHA256"
      || downloadUrl.searchParams.get("X-Amz-SignedHeaders") !== "host;if-match"
      || !/^[a-f0-9]{64}$/.test(String(downloadUrl.searchParams.get("X-Amz-Signature") || ""))
      || !/^[0-9]{8}T[0-9]{6}Z$/.test(String(downloadUrl.searchParams.get("X-Amz-Date") || ""))) {
    throw serviceError("invalid_request", "Object capability is invalid.");
  }
  const expires = boundedInteger(downloadUrl.searchParams.get("X-Amz-Expires"), {
    min: 30,
    max: 120,
    label: "Object capability lifetime",
  });
  const credential = String(downloadUrl.searchParams.get("X-Amz-Credential") || "");
  if (!/^[A-Za-z0-9._-]{1,255}\/[0-9]{8}\/[A-Za-z0-9._-]{1,100}\/s3\/aws4_request$/.test(credential)) {
    throw serviceError("invalid_request", "Object capability is invalid.");
  }
  const downloadHeaders = object?.downloadHeaders;
  if (!downloadHeaders || Object.keys(downloadHeaders).length !== 1 || downloadHeaders["If-Match"] !== etag) {
    throw serviceError("invalid_request", "Object generation binding is invalid.");
  }
  const structural = universal ? null : validatedStructuralProof(payload, sourceContentType);
  const poster = {
    timeMs: boundedInteger(payload?.poster?.timeMs, {
      min: 0,
      max: (structural ? structural.durationMs : VIDEO_MAX_DURATION_MS) - 1,
      label: "Poster time",
    }),
    maxBytes: boundedInteger(payload?.poster?.maxBytes, { min: 4, max: POSTER_MAX_BYTES, label: "Poster size limit" }),
    maxEdge: boundedInteger(payload?.poster?.maxEdge, { min: 64, max: POSTER_MAX_EDGE, label: "Poster edge limit" }),
  };
  if (payload?.poster?.contentType !== "image/jpeg") {
    throw serviceError("invalid_request", "Poster format is invalid.");
  }
  const output = payload?.output;
  const outputKey = String(output?.key || "");
  if (!OUTPUT_OBJECT_KEY.test(outputKey) || outputKey === objectKey || output?.contentType !== "video/mp4") {
    throw serviceError("invalid_request", "Delivery identity is invalid.");
  }
  let uploadUrl;
  try { uploadUrl = new URL(String(output?.uploadUrl || "")); }
  catch { throw serviceError("invalid_request", "Delivery capability is invalid."); }
  if (uploadUrl.protocol !== "https:"
      || uploadUrl.origin !== config.outputStorageBase.origin
      || uploadUrl.pathname !== expectedObjectPath(config.outputStorageBase, config.outputBucket, outputKey)
      || uploadUrl.username || uploadUrl.password || uploadUrl.hash) {
    throw serviceError("invalid_request", "Delivery capability is invalid.");
  }
  for (const key of uploadUrl.searchParams.keys()) {
    if (!allowedQuery.has(key) || uploadUrl.searchParams.getAll(key).length !== 1) {
      throw serviceError("invalid_request", "Delivery capability is invalid.");
    }
  }
  if (uploadUrl.searchParams.get("X-Amz-Algorithm") !== "AWS4-HMAC-SHA256"
      || uploadUrl.searchParams.get("X-Amz-SignedHeaders") !== "cache-control;content-type;host;if-none-match"
      || !/^[0-9]{8}T[0-9]{6}Z$/.test(String(uploadUrl.searchParams.get("X-Amz-Date") || ""))
      || !/^[a-f0-9]{64}$/.test(String(uploadUrl.searchParams.get("X-Amz-Signature") || ""))) {
    throw serviceError("invalid_request", "Delivery capability is invalid.");
  }
  boundedInteger(uploadUrl.searchParams.get("X-Amz-Expires"), {
    min: 30,
    max: 20 * 60,
    label: "Delivery capability lifetime",
  });
  const uploadHeaders = output?.uploadHeaders;
  if (!uploadHeaders || Object.keys(uploadHeaders).length !== 3
      || uploadHeaders["Cache-Control"] !== PUBLIC_MEDIA_CACHE_CONTROL
      || uploadHeaders["Content-Type"] !== "video/mp4" || uploadHeaders["If-None-Match"] !== "*") {
    throw serviceError("invalid_request", "Delivery headers are invalid.");
  }
  return {
    objectKey, byteSize, contentType: sourceContentType, etag, downloadUrl, downloadHeaders, structural, poster, expires,
    output: { key: outputKey, uploadUrl, uploadHeaders },
    universal,
  };
}

async function downloadExactObject(job, filePath, { fetchImpl, signal }) {
  let response;
  try {
    response = await fetchImpl(job.downloadUrl, {
      method: "GET",
      redirect: "error",
      headers: job.downloadHeaders,
      signal,
    });
  } catch (error) {
    throw serviceError("storage_unavailable", "Source download failed.", { status: 503, cause: error });
  }
  if (response?.status !== 200) {
    if (response?.status === 404 || response?.status === 412) {
      throw serviceError("object_changed", "Source object no longer matches its verified generation.", { status: 409 });
    }
    throw serviceError("storage_unavailable", "Source download failed.", { status: 503 });
  }
  const contentType = String(response.headers?.get?.("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  const contentLength = Number(response.headers?.get?.("content-length"));
  const etag = String(response.headers?.get?.("etag") || "").trim();
  if (contentType !== job.contentType || contentLength !== job.byteSize || etag !== job.etag || !response.body) {
    throw serviceError("object_changed", "Source object no longer matches its verified generation.", { status: 409 });
  }
  let observed = 0;
  const limiter = new TransformStream({
    transform(chunk, controller) {
      observed += chunk.byteLength;
      if (observed > job.byteSize) {
        controller.error(serviceError("object_changed", "Source object exceeded its signed size.", { status: 409 }));
        return;
      }
      controller.enqueue(chunk);
    },
  });
  try {
    await pipeline(
      createReadStreamFromWeb(response.body.pipeThrough(limiter)),
      createWriteStream(filePath, { flags: "wx", mode: 0o600 }),
      { signal },
    );
  } catch (error) {
    if (error?.code === "object_changed") throw error;
    throw serviceError("storage_unavailable", "Source download failed.", { status: 503, cause: error });
  }
  if (observed !== job.byteSize) {
    throw serviceError("object_changed", "Source object ended before its signed size.", { status: 409 });
  }
}

function createReadStreamFromWeb(stream) {
  // Node 24 implements Readable.fromWeb, but importing through node:stream here
  // would obscure the only conversion boundary. The async iterable returned by
  // a fetch body is accepted directly by pipeline.
  return stream;
}

function parseProbeJson(text, label) {
  let value;
  try { value = JSON.parse(text); }
  catch { throw serviceError("decode_failed", `${label} metadata is invalid.`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw serviceError("decode_failed", `${label} metadata is invalid.`);
  }
  return value;
}

async function probeVideo(filePath, config, {
  runProcess,
  directory,
  signal,
  sourceContentType = "video/mp4",
  structural,
  useStructuralSampleCount = false,
  maxFrameRate = MEDIA_VIDEO_MAX_FRAME_RATE,
}) {
  const result = await runProcess(config.ffprobe, [
    "-v", "error",
    "-protocol_whitelist", "file,pipe",
    "-f", "mov",
    "-show_entries", "stream=codec_type,codec_name,codec_tag_string,profile,level,pix_fmt,width,height,coded_width,coded_height,field_order,sample_aspect_ratio,avg_frame_rate,r_frame_rate,nb_frames,channels,channel_layout,sample_rate:stream_disposition=attached_pic:stream_tags=rotate:stream_side_data=rotation:format=format_name,duration:format_tags=major_brand,compatible_brands",
    "-of", "json",
    filePath,
  ], { cwd: directory, signal });
  const probe = parseProbeJson(result.stdout, "Video");
  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  const quickTime = sourceContentType === "video/quicktime";
  const video = streams.filter((stream) => stream?.codec_type === "video");
  const audio = streams.filter((stream) => stream?.codec_type === "audio");
  const discardedQuickTime = quickTime ? streams.filter((stream) => stream?.codec_type === "data"
    && new Set(["mebx", "tmcd"]).has(String(stream?.codec_tag_string || ""))) : [];
  const unknown = streams.filter((stream) => !new Set(["video", "audio"]).has(stream?.codec_type)
    && !discardedQuickTime.includes(stream));
  const formatNames = String(probe.format?.format_name || "").split(",");
  const majorBrand = String(probe.format?.tags?.major_brand || "");
  const compatibleRaw = String(probe.format?.tags?.compatible_brands || "");
  const compatibleBrands = compatibleRaw.length % 4 === 0
    ? Array.from({ length: compatibleRaw.length / 4 }, (_, index) => compatibleRaw.slice(index * 4, index * 4 + 4))
    : [];
  const durationMs = Math.round(Number(probe.format?.duration) * 1_000);
  const frameRate = (value) => {
    const match = /^([0-9]+)\/([1-9][0-9]*)$/.exec(String(value || ""));
    return match ? Number(match[1]) / Number(match[2]) : Number.NaN;
  };
  const avgFps = frameRate(video[0]?.avg_frame_rate);
  const realFps = frameRate(video[0]?.r_frame_rate);
  const videoProfile = String(video[0]?.profile || "");
  const videoLevel = Number(video[0]?.level);
  const sourceCodec = String(video[0]?.codec_name || "");
  const sourceCodecTag = String(video[0]?.codec_tag_string || "");
  const h264 = sourceCodec === "h264" && sourceCodecTag === "avc1";
  const hevc = sourceCodec === "hevc" && sourceCodecTag === "hvc1";
  const hevcProfileValid = (videoProfile === "Main" && video[0]?.pix_fmt === "yuv420p")
    || (videoProfile === "Main 10" && new Set(["yuv420p", "yuv420p10le"]).has(video[0]?.pix_fmt));
  const codecProfileValid = h264
    ? new Set(["Baseline", "Constrained Baseline", "Main", "High"]).has(videoProfile)
      && Number.isInteger(videoLevel) && videoLevel >= 10 && videoLevel <= 52
      && video[0]?.pix_fmt === "yuv420p"
    : hevc
      && hevcProfileValid
      && Number.isInteger(videoLevel) && videoLevel >= 30 && videoLevel <= 186;
  const containerValid = quickTime
    ? formatNames.includes("mov") && majorBrand === QUICKTIME_MAJOR_BRAND && compatibleBrands.length
      && compatibleBrands.every((brand) => QUICKTIME_COMPATIBLE_BRANDS.has(brand))
    : formatNames.includes("mp4") && ISO_MP4_MAJOR_BRANDS.has(majorBrand) && compatibleBrands.length
      && compatibleBrands.every((brand) => ISO_MP4_COMPATIBLE_BRANDS.has(brand));
  const audioProfile = String(audio[0]?.profile || "");
  const sampleRate = Number(audio[0]?.sample_rate);
  const widthValue = Number(video[0]?.width);
  const heightValue = Number(video[0]?.height);
  const codedWidth = Number(video[0]?.coded_width);
  const codedHeight = Number(video[0]?.coded_height);
  const structuralCodedWidth = Number(structural?.codedWidth);
  const structuralCodedHeight = Number(structural?.codedHeight);
  // FFprobe 5.1 reports the cropped display axis as coded_width/height for
  // current iPhone AVC MOVs. The signed web preflight still carries the SPS
  // macroblock envelope. Accept only either of those two exact reports, and use
  // the larger signed envelope—not FFprobe's presentation—for decode-work.
  const hasStructuralEnvelope = Number.isSafeInteger(structuralCodedWidth)
    && Number.isSafeInteger(structuralCodedHeight);
  const roundedDisplayWidth = Math.ceil(widthValue / 16) * 16;
  const roundedDisplayHeight = Math.ceil(heightValue / 16) * 16;
  const codedReportMatches = hasStructuralEnvelope
    ? new Set([widthValue, structuralCodedWidth]).has(codedWidth)
      && new Set([heightValue, structuralCodedHeight]).has(codedHeight)
    : new Set([widthValue, roundedDisplayWidth]).has(codedWidth)
      && new Set([heightValue, roundedDisplayHeight]).has(codedHeight);
  const hasSampleAspectRatio = Object.hasOwn(video[0] || {}, "sample_aspect_ratio");
  const sampleAspectRatio = String(video[0]?.sample_aspect_ratio || "");
  // FFprobe's JSON writer omits optional fields whose value is N/A. Reviewed
  // iPhone QuickTime and mp42 files both use that representation when they
  // have no explicit pixel-aspect signal. Accept the omission only after the
  // bounded parser has signed the coded envelope (and rejected non-square
  // `pasp`). QuickTime can also report the equivalent textual N/A form. Any
  // explicit empty or non-square value remains invalid, and generated
  // derivatives have no structural envelope so they stay strictly 1:1.
  const noExplicitSourceAspect = !hasSampleAspectRatio
    || (quickTime && sampleAspectRatio === "N/A");
  const sourceAspectAccepted = sampleAspectRatio === "1:1"
    || (hasStructuralEnvelope && noExplicitSourceAspect);
  const estimatedSamples = Number.isFinite(avgFps) && Number.isFinite(realFps) && Number.isSafeInteger(durationMs)
    ? Math.ceil(Math.max(avgFps, realFps) * (durationMs / 1_000))
    : VIDEO_MAX_SAMPLES + 1;
  // r_frame_rate is a guessed common timestamp base, not a frame count; the
  // format duration can also include audio beyond the video. Only replace that
  // conservative estimate for the source when FFprobe's positive integer count
  // agrees exactly with the signed, bounded STTS/STSZ proof. Missing/unknown
  // counts retain the estimate, and delivery probes never use this exception.
  const reportedSamples = useStructuralSampleCount && /^[1-9][0-9]*$/.test(String(video[0]?.nb_frames ?? ""))
    ? Number(video[0].nb_frames) : Number.NaN;
  const hasReportedSamples = Number.isSafeInteger(reportedSamples);
  const sourceCountMatches = hasReportedSamples && reportedSamples === structural?.sampleCount;
  const workSamples = sourceCountMatches ? reportedSamples : estimatedSamples;
  const workWidth = hasStructuralEnvelope ? structuralCodedWidth : roundedDisplayWidth;
  const workHeight = hasStructuralEnvelope ? structuralCodedHeight : roundedDisplayHeight;
  const estimatedCodedWork = Number.isSafeInteger(workWidth)
      && Number.isSafeInteger(workHeight) && Number.isSafeInteger(workSamples)
    ? BigInt(workWidth) * BigInt(workHeight) * BigInt(workSamples)
    : VIDEO_MAX_CODED_PIXEL_SAMPLES + 1n;
  if (video.length !== 1 || (!h264 && !hevc) || !codecProfileValid
      || video[0]?.field_order !== "progressive"
      || !sourceAspectAccepted
      || video[0]?.disposition?.attached_pic === 1
      || !Number.isFinite(avgFps) || avgFps <= 0 || avgFps > maxFrameRate + 0.01
      || !Number.isFinite(realFps) || realFps <= 0 || realFps > maxFrameRate + 0.01
      || audio.length > 1 || audio.some((stream) => stream?.codec_name !== "aac" || stream?.codec_tag_string !== "mp4a")
      || (audio.length && (audioProfile !== "LC"
        || !new Set([1, 2]).has(Number(audio[0]?.channels))
        || !new Set(["mono", "stereo"]).has(String(audio[0]?.channel_layout || ""))
        || !Number.isInteger(sampleRate) || sampleRate < 8_000 || sampleRate > 48_000))
      || !Number.isSafeInteger(codedWidth) || !Number.isSafeInteger(codedHeight)
      || Math.min(widthValue, heightValue) > MEDIA_VIDEO_SOURCE_MAX_SHORT_EDGE
      || !codedReportMatches
      || (hasReportedSamples && !sourceCountMatches)
      || workSamples > VIDEO_MAX_SAMPLES || estimatedCodedWork > VIDEO_MAX_CODED_PIXEL_SAMPLES
      || unknown.length
      || discardedQuickTime.length > VIDEO_VERIFIER_MAX_DISCARDED_QUICKTIME_TRACKS
      || !containerValid
      || !Number.isSafeInteger(durationMs) || durationMs < 1 || durationMs > VIDEO_MAX_DURATION_MS) {
    throw serviceError("unsupported_media", "Clip must be a bounded compatible MP4 or QuickTime MOV.");
  }
  const width = boundedInteger(video[0]?.width, { min: 1, max: VIDEO_MAX_EDGE, label: "Decoded width" });
  const height = boundedInteger(video[0]?.height, { min: 1, max: VIDEO_MAX_EDGE, label: "Decoded height" });
  const rotations = [
    video[0]?.tags?.rotate,
    ...(Array.isArray(video[0]?.side_data_list) ? video[0].side_data_list.map((item) => item?.rotation) : []),
  ].filter((value) => value !== undefined && value !== null && value !== "")
    .map((value) => ((Number(value) % 360) + 360) % 360);
  if (rotations.some((value) => ![0, 90, 180, 270].includes(value))
      || rotations.some((value) => value !== rotations[0])) {
    throw serviceError("unsupported_media", "Clip rotation metadata is invalid.");
  }
  const rotation = rotations[0] || 0;
  return {
    width,
    height,
    codedWidth,
    codedHeight,
    durationMs,
    rotation,
    frameRate: Math.max(avgFps, realFps),
    codec: hevc ? "hevc" : "h264",
    audioCodec: audio.length ? "aac" : "none",
  };
}

function probedFrameRate(value) {
  const match = /^([0-9]+)\/([1-9][0-9]*)$/.exec(String(value || ""));
  const rate = match ? Number(match[1]) / Number(match[2]) : Number.NaN;
  return Number.isFinite(rate) && rate > 0 ? rate : Number.NaN;
}

// Reads any admitted container without the MP4-only structural proof. The
// resource budgets are the same: ten minutes, 4096 by 2160, 240 fps and the
// shared decode-work ceiling. A file FFprobe cannot read is the member's
// file, so it is a signed source rejection rather than a retryable fault.
export async function probeUniversalVideo(filePath, contentType, config, { runProcess, directory, signal }) {
  const demuxer = UNIVERSAL_DEMUXERS[contentType];
  if (!demuxer) throw serviceError("unsupported_media", "Clip container is not supported.");
  let result;
  try {
    result = await runProcess(config.ffprobe, [
      "-v", "error",
      "-protocol_whitelist", "file,pipe",
      "-f", demuxer,
      "-show_entries", "stream=index,codec_type,codec_name,width,height,field_order,sample_aspect_ratio,avg_frame_rate,r_frame_rate,nb_frames,duration,channels:stream_disposition=attached_pic:stream_tags=rotate:stream_side_data=rotation:format=duration",
      "-of", "json",
      filePath,
    ], { cwd: directory, signal });
  } catch (error) {
    if (error?.code === "decode_failed") throw serviceError("unsupported_media", "Clip could not be read.", { cause: error });
    throw error;
  }
  let probe;
  try { probe = parseProbeJson(result.stdout, "Video"); }
  catch (error) { throw serviceError("unsupported_media", "Clip could not be read.", { cause: error }); }
  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  const video = streams.find((stream) => stream?.codec_type === "video"
    && stream?.disposition?.attached_pic !== 1
    && UNIVERSAL_VIDEO_CODECS.has(String(stream?.codec_name || "")));
  const audio = streams.find((stream) => stream?.codec_type === "audio"
    && UNIVERSAL_AUDIO_CODECS.has(String(stream?.codec_name || ""))
    && Number(stream?.channels) >= 1);
  const width = Number(video?.width);
  const height = Number(video?.height);
  const seconds = [probe.format?.duration, video?.duration].map(Number).find((value) => Number.isFinite(value) && value > 0);
  // Browser recordings (MediaRecorder WebM) often store no length at all. The
  // conversion then runs within the job deadline and the converted copy's
  // measured length is checked against the same ten-minute limit.
  const durationMs = Number.isFinite(Number(seconds)) ? Math.round(Number(seconds) * 1_000) : null;
  const knownDuration = Number.isSafeInteger(durationMs) && durationMs > 0;
  // Variable-frame-rate recordings often report a timebase such as 1000/1 as
  // their rate. Only a believable rate is used; otherwise budget at 60 fps and
  // deliver at 30.
  const frames = /^[1-9][0-9]*$/.test(String(video?.nb_frames ?? "")) ? Number(video.nb_frames) : Number.NaN;
  const reportedRates = [probedFrameRate(video?.avg_frame_rate), probedFrameRate(video?.r_frame_rate),
    Number.isSafeInteger(frames) && knownDuration ? frames / (durationMs / 1_000) : Number.NaN]
    .filter((rate) => Number.isFinite(rate) && rate <= MEDIA_VIDEO_MAX_FRAME_RATE + 0.01);
  const sourceFrameRate = reportedRates.length ? Math.max(...reportedRates) : Number.NaN;
  const budgetFrameRate = Number.isFinite(sourceFrameRate) ? sourceFrameRate : MEDIA_VIDEO_DELIVERY_MAX_FRAME_RATE;
  const outputFrameRate = Number.isFinite(sourceFrameRate)
    ? Math.max(1, Math.min(MEDIA_VIDEO_DELIVERY_MAX_FRAME_RATE, Math.round(sourceFrameRate)))
    : UNIVERSAL_DEFAULT_FRAME_RATE;
  const codedWidth = Math.ceil(width / 16) * 16;
  const codedHeight = Math.ceil(height / 16) * 16;
  const samples = knownDuration ? Math.ceil(budgetFrameRate * (durationMs / 1_000)) : 0;
  const codedWork = Number.isSafeInteger(codedWidth) && Number.isSafeInteger(codedHeight)
    ? BigInt(codedWidth) * BigInt(codedHeight) * BigInt(samples)
    : VIDEO_MAX_CODED_PIXEL_SAMPLES + 1n;
  if (!video
      || !Number.isSafeInteger(width) || width < 2 || width > VIDEO_MAX_EDGE
      || !Number.isSafeInteger(height) || height < 2 || height > VIDEO_MAX_EDGE
      || Math.min(width, height) > MEDIA_VIDEO_SOURCE_MAX_SHORT_EDGE
      || (knownDuration && durationMs > VIDEO_MAX_DURATION_MS)
      || samples > VIDEO_MAX_SAMPLES || codedWork > VIDEO_MAX_CODED_PIXEL_SAMPLES) {
    throw serviceError("unsupported_media", "Clip is outside the supported size, length or format.");
  }
  const rotations = [
    video?.tags?.rotate,
    ...(Array.isArray(video?.side_data_list) ? video.side_data_list.map((item) => item?.rotation) : []),
  ].filter((value) => value !== undefined && value !== null && value !== "")
    .map((value) => ((Math.round(Number(value)) % 360) + 360) % 360)
    .filter((value) => [0, 90, 180, 270].includes(value));
  return {
    width,
    height,
    codedWidth,
    codedHeight,
    durationMs: knownDuration ? durationMs : null,
    rotation: rotations[0] || 0,
    frameRate: Number.isFinite(sourceFrameRate) ? sourceFrameRate : UNIVERSAL_DEFAULT_FRAME_RATE,
    codec: String(video.codec_name),
    audioCodec: audio ? String(audio.codec_name) : "none",
    universal: true,
    demuxer,
    videoIndex: Number(video.index),
    audioIndex: audio ? Number(audio.index) : null,
    interlaced: !new Set(["progressive", "unknown", "", "undefined"]).has(String(video?.field_order ?? "")),
    sampleAspectRatio: String(video?.sample_aspect_ratio ?? ""),
    outputFrameRate,
  };
}

function publicVideoSummary(video) {
  return {
    width: video.width,
    height: video.height,
    codedWidth: video.codedWidth,
    codedHeight: video.codedHeight,
    durationMs: video.durationMs,
    rotation: video.rotation,
    frameRate: video.frameRate,
    codec: video.codec,
    audioCodec: video.audioCodec,
  };
}

async function decodeAllStreams(filePath, config, { runProcess, directory, signal }) {
  await runProcess(config.ffmpeg, [
    "-nostdin",
    "-v", "error",
    "-xerror",
    "-err_detect", "explode",
    "-threads", "2",
    "-filter_threads", "1",
    "-protocol_whitelist", "file,pipe",
    "-f", "mov",
    "-i", filePath,
    "-map", "0:v:0",
    "-map", "0:a:0?",
    "-f", "null",
    "-",
  ], { cwd: directory, signal });
}

export function videoDeliveryStrategy(video = {}) {
  return video?.codec === "h264"
    && new Set(["aac", "none"]).has(video?.audioCodec)
    && Number(video?.rotation) === 0
    && (video?.frameRate === undefined
      || (Number.isFinite(video.frameRate) && video.frameRate > 0
        && video.frameRate <= MEDIA_VIDEO_DELIVERY_MAX_FRAME_RATE + 0.01))
    && Number.isSafeInteger(video?.width)
    && video.width >= 1
    && video.width <= DELIVERY_MAX_WIDTH
    && Number.isSafeInteger(video?.height)
    && video.height >= 1
    && video.height <= DELIVERY_MAX_HEIGHT
    ? "remux"
    : "transcode";
}

export function videoTranscodeBitrateBudget(durationMs) {
  if (!Number.isSafeInteger(durationMs) || durationMs < 1 || durationMs > VIDEO_MAX_DURATION_MS) {
    throw serviceError("invalid_request", "Video duration is invalid for the delivery byte budget.");
  }
  const seconds = durationMs / 1_000;
  // Reserve the complete AAC allowance even for silent sources, and account
  // for one full VBV buffer in addition to the sustained video rate. A fixed
  // 11 Mbps ceiling alone could expand a ten-minute HEVC source beyond 500 MiB.
  const availableVideoBits = DELIVERY_STREAM_BUDGET_BYTES * 8 - DELIVERY_AUDIO_RATE * seconds;
  const maxRate = Math.min(DELIVERY_VIDEO_MAX_RATE,
    Math.floor(availableVideoBits / (seconds + DELIVERY_VBV_SECONDS) / 1_000) * 1_000);
  if (!Number.isSafeInteger(maxRate) || maxRate < 1_000) {
    throw serviceError("invalid_request", "Video has no safe delivery bitrate allowance.");
  }
  return { maxRate, bufferSize: maxRate * DELIVERY_VBV_SECONDS, audioRate: DELIVERY_AUDIO_RATE };
}

const SQUARE_OR_UNSET_ASPECT = new Set(["", "0:1", "1:1", "N/A", "undefined"]);

// Most phone and app-saved clips (TikTok, Instagram, camera rolls) are already
// H.264/AAC in MP4 at a size browsers play. Those are repackaged without
// re-encoding, which takes seconds instead of minutes on the converter's one
// CPU. The copy must still pass the same strict delivery probe and full decode
// as a converted clip; anything it fails is converted in full instead, so this
// shortcut can never be the reason a clip is refused.
export function universalRemuxEligible(video = {}) {
  const width = Number(video?.width);
  const height = Number(video?.height);
  return video?.universal === true
    && video.demuxer === "mov"
    && video.codec === "h264"
    && new Set(["aac", "none"]).has(video.audioCodec)
    && Number(video.rotation) === 0
    && video.interlaced !== true
    && Number.isFinite(video.frameRate) && video.frameRate > 0
    && video.frameRate <= MEDIA_VIDEO_DELIVERY_MAX_FRAME_RATE + 0.01
    && Number.isSafeInteger(video.durationMs) && video.durationMs > 0
    && Number.isSafeInteger(width) && Number.isSafeInteger(height)
    && Math.max(width, height) <= DELIVERY_MAX_WIDTH
    && Math.min(width, height) <= DELIVERY_MAX_HEIGHT
    && SQUARE_OR_UNSET_ASPECT.has(String(video.sampleAspectRatio ?? ""));
}

async function createUniversalRemux(sourcePath, deliveryPath, sourceVideo, config, { runProcess, directory, signal }) {
  await runProcess(config.ffmpeg, [
    "-nostdin", "-v", "error",
    "-protocol_whitelist", "file,pipe", "-f", "mov", "-i", sourcePath,
    "-map", `0:${sourceVideo.videoIndex}`,
    ...(Number.isSafeInteger(sourceVideo.audioIndex) ? ["-map", `0:${sourceVideo.audioIndex}`] : []),
    "-c:v", "copy", "-c:a", "copy",
    // Many phones leave the pixel shape unset. Only square-pixel sources get
    // here, so state it explicitly the way the delivery contract requires.
    "-bsf:v", "h264_metadata=sample_aspect_ratio=1/1",
    "-map_metadata", "-1", "-map_chapters", "-1", "-metadata:s:v:0", "rotate=0",
    "-movflags", "+faststart", "-brand", "mp42", "-f", "mp4", "-y", deliveryPath,
  ], { cwd: directory, signal });
  const file = await stat(deliveryPath);
  if (!file.isFile() || file.size < 16 || file.size > VIDEO_MAX_BYTES) {
    throw serviceError("delivery_invalid", "Repackaged clip is outside its byte limit.");
  }
  const video = await probeVideo(deliveryPath, config, {
    runProcess,
    directory,
    signal,
    maxFrameRate: MEDIA_VIDEO_DELIVERY_MAX_FRAME_RATE,
  });
  if (video.rotation !== 0 || video.codec !== "h264"
      || video.audioCodec !== sourceVideo.audioCodec
      || video.width !== sourceVideo.width
      || video.height !== sourceVideo.height
      || Math.abs(video.durationMs - sourceVideo.durationMs) > 1_500) {
    throw serviceError("delivery_invalid", "Repackaged clip changed its streams.");
  }
  await decodeAllStreams(deliveryPath, config, { runProcess, directory, signal });
  return { file, video, strategy: "remux" };
}

// One line for the private converter log: the stable code plus the first
// underlying cause. Never includes object keys or signed URLs.
function jobFailureSummary(error) {
  const parts = [String(error?.code || "error"), String(error?.message || "")].filter(Boolean);
  for (let cause = error?.cause, depth = 0; cause && depth < 3; cause = cause.cause, depth += 1) {
    if (cause?.message) parts.push(String(cause.message));
  }
  return parts.join(": ").replace(/https?:\/\/\S+/gu, "[url]").slice(0, 700);
}

export function universalDeliveryDimensions(video) {
  const width = Number(video?.width);
  const height = Number(video?.height);
  if (![width, height].every((value) => Number.isSafeInteger(value) && value >= 2 && value <= VIDEO_MAX_EDGE)) {
    throw serviceError("unsupported_media", "Clip dimensions are invalid.");
  }
  const rawAspect = String(video?.sampleAspectRatio ?? "");
  let aspect = 1;
  if (!new Set(["", "N/A", "0:1"]).has(rawAspect)) {
    const parts = /^([0-9]{1,10}):([0-9]{1,10})$/u.exec(rawAspect);
    if (!parts || Number(parts[1]) <= 0 || Number(parts[2]) <= 0) {
      throw serviceError("unsupported_media", "Clip pixel shape is invalid.");
    }
    aspect = Number(parts[1]) / Number(parts[2]);
  }
  // FFmpeg auto-rotates before the filter graph. Work out the displayed size
  // without allocating a squared-pixel intermediate: SAR is untrusted and can
  // otherwise make a tiny source demand a frame hundreds of millions wide.
  let displayWidth = width * aspect;
  let displayHeight = height;
  if (video?.rotation === 90 || video?.rotation === 270) {
    [displayWidth, displayHeight] = [displayHeight, displayWidth];
  }
  const ratio = Math.min(1,
    DELIVERY_MAX_WIDTH / Math.max(displayWidth, displayHeight),
    DELIVERY_MAX_HEIGHT / Math.min(displayWidth, displayHeight));
  return {
    width: Math.max(2, Math.floor(displayWidth * ratio / 2) * 2),
    height: Math.max(2, Math.floor(displayHeight * ratio / 2) * 2),
  };
}

async function createSanitizedDelivery(
  sourcePath,
  deliveryPath,
  sourceVideo,
  structural,
  config,
  { runProcess, directory, signal, log },
) {
  const universal = sourceVideo?.universal === true;
  if (universal && universalRemuxEligible(sourceVideo)) {
    try {
      return await createUniversalRemux(sourcePath, deliveryPath, sourceVideo, config, { runProcess, directory, signal });
    } catch (error) {
      if (signal?.aborted) throw error;
      log?.(`fast repackage skipped, converting in full: ${jobFailureSummary(error)}`);
    }
  }
  const strategy = universal ? "transcode" : videoDeliveryStrategy(sourceVideo);
  // An unknown universal length is budgeted as the longest allowed clip.
  const bitrate = strategy === "transcode"
    ? videoTranscodeBitrateBudget(sourceVideo.durationMs ?? VIDEO_MAX_DURATION_MS)
    : null;
  const frameRateFilter = sourceVideo.frameRate > MEDIA_VIDEO_DELIVERY_MAX_FRAME_RATE + 0.01
    ? `fps=${MEDIA_VIDEO_DELIVERY_MAX_FRAME_RATE},`
    : "";
  // A universal source is only ever read by this conversion and ffprobe. It is
  // decoded tolerantly, the way a phone recording with one damaged frame still
  // plays, and the output below is then decoded strictly before publication.
  const commonInput = universal
    ? [
        "-nostdin", "-v", "error",
        "-threads", "2", "-filter_threads", "1",
        "-protocol_whitelist", "file,pipe", "-f", sourceVideo.demuxer, "-i", sourcePath,
        "-map", `0:${sourceVideo.videoIndex}`,
        ...(Number.isSafeInteger(sourceVideo.audioIndex) ? ["-map", `0:${sourceVideo.audioIndex}`] : []),
      ]
    : [
        "-nostdin", "-v", "error", "-xerror", "-err_detect", "explode",
        "-threads", "2", "-filter_threads", "1",
        "-protocol_whitelist", "file,pipe", "-f", "mov", "-i", sourcePath,
        "-map", "0:v:0", "-map", "0:a:0?",
      ];
  // Apply the already-bounded final square-pixel size in one allocation. A
  // portrait keeps its full 1080 width and anamorphic footage keeps its shape.
  const dimensions = universal ? universalDeliveryDimensions(sourceVideo) : null;
  const videoFilter = universal
    ? `${sourceVideo.interlaced ? "yadif=deint=interlaced," : ""}fps=${sourceVideo.outputFrameRate},`
      + `scale=w=${dimensions.width}:h=${dimensions.height},setsar=1`
    : `${frameRateFilter}scale=w='min(${DELIVERY_MAX_WIDTH},iw)':h='min(${DELIVERY_MAX_HEIGHT},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1`;
  const output = strategy === "remux"
    ? [
        // The source has already passed the strict H.264/AAC/container probe.
        // Stream-copy only when no scale or rotation normalization is needed;
        // selecting A/V streams plus dropping metadata/chapters removes camera
        // location, device and discarded QuickTime tracks without re-encoding.
        "-c:v", "copy", "-c:a", "copy",
      ]
    : [
        `-vf`, videoFilter,
        // Concert footage is often grainy enough that unconstrained CRF H.264 can
        // expand beyond the bounded delivery contract even from a smaller HEVC
        // source. Duration-aware VBV reserves audio/container/burst headroom;
        // CRF still spends fewer bits on easier scenes and short clips retain
        // the existing 11 Mbps ceiling. Never truncate output with -fs or -t.
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
        "-maxrate", String(bitrate.maxRate), "-bufsize", String(bitrate.bufferSize),
        "-profile:v", "high", "-level:v", "4.2", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-profile:a", "aac_low", "-ac", "2", "-ar", "48000", "-b:a", String(bitrate.audioRate),
      ];
  try {
    await runProcess(config.ffmpeg, [
      ...commonInput,
      ...output,
      "-map_metadata", "-1", "-map_chapters", "-1", "-metadata:s:v:0", "rotate=0",
      "-movflags", "+faststart", "-brand", "mp42", "-f", "mp4", "-y", deliveryPath,
    ], { cwd: directory, signal });
  } catch (error) {
    // Only the member's file is read here for a universal source, so a
    // failed conversion means FFmpeg could not decode that file.
    if (universal && error?.code === "decode_failed") {
      throw serviceError("unsupported_media", "Clip could not be decoded.", { cause: error });
    }
    throw error;
  }
  const file = await stat(deliveryPath);
  if (!file.isFile() || file.size < 16 || file.size > VIDEO_MAX_BYTES) {
    throw serviceError("delivery_invalid", "Sanitized delivery is outside its byte limit.");
  }
  const video = await probeVideo(deliveryPath, config, {
    runProcess,
    directory,
    signal,
    // A stream copy preserves the already-proven AVC coded envelope. Passing
    // that signed envelope also lets reviewed iPhone AVC files retain their
    // valid implicit square-pixel representation when ffprobe omits SAR.
    structural: strategy === "remux" ? structural : undefined,
    maxFrameRate: MEDIA_VIDEO_DELIVERY_MAX_FRAME_RATE,
  });
  if (video.rotation !== 0) throw serviceError("delivery_invalid", "Sanitized delivery retained rotation metadata.");
  if (strategy === "remux" && (video.codec !== "h264"
      || video.audioCodec !== sourceVideo.audioCodec
      || video.width !== sourceVideo.width
      || video.height !== sourceVideo.height
      || Math.abs(video.durationMs - sourceVideo.durationMs) > 1_500)) {
    throw serviceError("delivery_invalid", "Sanitized remux changed the admitted clip streams.");
  }
  // Stream-copy deliberately does not decode source packets. This full output
  // pass remains mandatory for both strategies, so corrupt later access units
  // cannot be published merely because metadata and the first frame looked safe.
  await decodeAllStreams(deliveryPath, config, { runProcess, directory, signal });
  return { file, video, strategy };
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function uploadSanitizedDelivery(job, deliveryPath, delivery, { fetchImpl, signal }) {
  const sha256 = await sha256File(deliveryPath);
  let response;
  try {
    response = await fetchImpl(job.output.uploadUrl, {
      method: "PUT",
      redirect: "error",
      headers: { ...job.output.uploadHeaders, "Content-Length": String(delivery.file.size) },
      body: createReadStream(deliveryPath),
      duplex: "half",
      signal,
    });
  } catch (error) {
    throw serviceError("storage_unavailable", "Sanitized delivery upload failed.", { status: 503, cause: error });
  }
  if (!response || !((response.status >= 200 && response.status < 300) || response.status === 412)) {
    throw serviceError("storage_unavailable", "Sanitized delivery upload failed.", { status: 503 });
  }
  return {
    key: job.output.key,
    contentType: "video/mp4",
    byteSize: delivery.file.size,
    sha256,
    width: delivery.video.width,
    height: delivery.video.height,
    durationMs: delivery.video.durationMs,
    rotation: 0,
    codec: delivery.video.codec,
    audioCodec: delivery.video.audioCodec,
    uploadStatus: response.status === 412 ? "existing" : "created",
  };
}

async function generateAndVerifyPoster(filePath, posterPath, job, video, config, { runProcess, directory, signal }) {
  const seconds = (job.poster.timeMs / 1_000).toFixed(3);
  const scale = `scale=w='min(${job.poster.maxEdge},iw)':h='min(${job.poster.maxEdge},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1`;
  await runProcess(config.ffmpeg, [
    "-nostdin",
    "-v", "error",
    "-xerror",
    "-threads", "2",
    "-filter_threads", "1",
    "-protocol_whitelist", "file,pipe",
    "-ss", seconds,
    "-f", "mov",
    "-i", filePath,
    "-map", "0:v:0",
    "-frames:v", "1",
    "-vf", scale,
    "-map_metadata", "-1",
    // FFmpeg's MJPEG encoder otherwise adds a Lavc COM marker even after
    // metadata mapping is disabled. Public covers are deliberately accepted
    // only when the shared image inspector finds no comment/metadata segment.
    "-flags:v", "+bitexact",
    "-q:v", "4",
    "-f", "image2",
    "-y",
    posterPath,
  ], { cwd: directory, signal });
  const file = await stat(posterPath);
  if (!file.isFile() || file.size < 4 || file.size > job.poster.maxBytes) {
    throw serviceError("poster_invalid", "Generated cover is outside its byte limit.");
  }
  const probeResult = await runProcess(config.ffprobe, [
    "-v", "error",
    "-f", "image2",
    "-c:v", "mjpeg",
    "-show_entries", "stream=codec_type,codec_name,width,height",
    "-of", "json",
    posterPath,
  ], { cwd: directory, signal });
  const probe = parseProbeJson(probeResult.stdout, "Poster");
  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  if (streams.length !== 1 || streams[0]?.codec_type !== "video" || streams[0]?.codec_name !== "mjpeg") {
    throw serviceError("poster_invalid", "Generated cover codec is invalid.");
  }
  const width = boundedInteger(streams[0]?.width, { min: 1, max: job.poster.maxEdge, label: "Poster width" });
  const height = boundedInteger(streams[0]?.height, { min: 1, max: job.poster.maxEdge, label: "Poster height" });
  const displayWidth = video.rotation === 90 || video.rotation === 270 ? video.height : video.width;
  const displayHeight = video.rotation === 90 || video.rotation === 270 ? video.width : video.height;
  const sourceRatio = displayWidth / displayHeight;
  const posterRatio = width / height;
  if (Math.abs(sourceRatio - posterRatio) > Math.max(0.02, sourceRatio * 0.02)) {
    throw serviceError("poster_invalid", "Generated cover orientation is invalid.");
  }
  // Decode the generated artifact independently. Successful encode alone is not
  // accepted as proof that the returned JPEG can be consumed by clients.
  await runProcess(config.ffmpeg, [
    "-nostdin",
    "-v", "error",
    "-xerror",
    "-threads", "1",
    "-protocol_whitelist", "file,pipe",
    "-f", "image2",
    "-c:v", "mjpeg",
    "-i", posterPath,
    "-frames:v", "1",
    "-f", "null",
    "-",
  ], { cwd: directory, signal });
  const bytes = await readFile(posterPath);
  if (bytes.byteLength !== file.size || bytes[0] !== 0xff || bytes[1] !== 0xd8
      || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
    throw serviceError("poster_invalid", "Generated cover bytes are invalid.");
  }
  return {
    contentType: "image/jpeg",
    byteSize: bytes.byteLength,
    width,
    height,
    timeMs: job.poster.timeMs,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    dataBase64: bytes.toString("base64"),
  };
}

export async function runVideoVerifierJob(payload, {
  config,
  fetchImpl = globalThis.fetch,
  runProcess = runVerifierProcess,
  signal,
  temporaryRoot = tmpdir(),
  log = null,
} = {}) {
  if (!config?.configured || typeof fetchImpl !== "function") {
    throw serviceError("decoder_unavailable", "Verifier is not configured.", { status: 503 });
  }
  const job = validateVideoVerifierJob(payload, config);
  const directory = await mkdtemp(join(temporaryRoot, "pit-video-verify-"));
  const sourcePath = join(directory, `source.${videoVerifierSourceExtension(job.contentType)}`);
  const deliveryPath = join(directory, "delivery.mp4");
  const posterPath = join(directory, "poster.jpg");
  // Each step's time goes in the private job log, so a slow or failing clip
  // shows exactly where it stopped. A failure carries the step it happened in.
  const jobStartedAt = Date.now();
  const timings = [];
  let step = "download";
  let stepStartedAt = jobStartedAt;
  const nextStep = (name) => {
    const at = Date.now();
    timings.push(`${step} ${((at - stepStartedAt) / 1_000).toFixed(1)}s`);
    step = name;
    stepStartedAt = at;
  };
  try {
    await downloadExactObject(job, sourcePath, { fetchImpl, signal });
    nextStep("probe");
    let video;
    if (job.universal) {
      video = await probeUniversalVideo(sourcePath, job.contentType, config, { runProcess, directory, signal });
    } else {
      video = await probeVideo(sourcePath, config, {
        runProcess,
        directory,
        signal,
        sourceContentType: job.contentType,
        structural: job.structural,
        useStructuralSampleCount: true,
      });
      if (video.width !== job.structural.width
          || video.height !== job.structural.height
          || (job.structural.sourceCodec !== undefined && video.codec !== job.structural.sourceCodec)
          || Math.abs(video.durationMs - job.structural.durationMs) > 1_500) {
        throw serviceError("metadata_mismatch", "Decoded clip does not match structural preflight.", { status: 409 });
      }
    }
    // The following xerror/err_detect transcode necessarily decodes every
    // selected source frame and audio packet. A separate full source decode was
    // redundant and doubled the slowest HEVC path without adding a new proof.
    nextStep("convert");
    const delivery = await createSanitizedDelivery(
      sourcePath,
      deliveryPath,
      video,
      job.structural,
      config,
      { runProcess, directory, signal, log },
    );
    nextStep("cover");
    // A source that stored no length takes the converted copy's measurement,
    // which the strict delivery probe has already held to ten minutes.
    if (video.durationMs === null) video = { ...video, durationMs: delivery.video.durationMs };
    const posterJob = job.universal
      ? {
          ...job,
          poster: {
            ...job.poster,
            timeMs: videoVerifierUniversalPosterTimeMs(job.poster.timeMs, Math.min(video.durationMs, delivery.video.durationMs)),
          },
        }
      : job;
    const poster = await generateAndVerifyPoster(deliveryPath, posterPath, posterJob, delivery.video, config, { runProcess, directory, signal });
    if (!SHA256.test(poster.sha256)) throw serviceError("poster_invalid", "Generated cover hash is invalid.");
    nextStep("upload");
    const published = await uploadSanitizedDelivery(job, deliveryPath, delivery, { fetchImpl, signal });
    nextStep("done");
    log?.(`converted ${job.contentType} ${video.codec}/${video.audioCodec} ${video.width}x${video.height} `
      + `${(Number(delivery.video.durationMs) / 1_000).toFixed(1)}s by ${delivery.strategy} `
      + `in ${((Date.now() - jobStartedAt) / 1_000).toFixed(1)}s (${timings.join(", ")})`);
    return {
      ok: true,
      protocol: VIDEO_VERIFIER_PROTOCOL_VERSION,
      pipeline: VIDEO_VERIFIER_PIPELINE_VERSION,
      object: { key: job.objectKey, byteSize: job.byteSize, contentType: job.contentType, etag: job.etag },
      video: job.universal ? publicVideoSummary(video) : video,
      delivery: published,
      poster,
    };
  } catch (error) {
    if (error && typeof error === "object" && !error.verifierStep) {
      try { Object.defineProperty(error, "verifierStep", { value: step, enumerable: false }); } catch { /* frozen */ }
    }
    log?.(`failed ${job.contentType} at ${step} after ${((Date.now() - jobStartedAt) / 1_000).toFixed(1)}s `
      + `(${timings.join(", ") || "no step finished"}): ${jobFailureSummary(error)}`);
    throw error;
  } finally {
    // The directory was created by mkdtemp under the configured temp root and
    // never contains user-derived path segments. Cleanup runs on success,
    // timeout, client disconnect, decode failure, and service shutdown.
    await rm(directory, { recursive: true, force: true });
  }
}

async function prerequisiteProbe(config, { runProcess, signal, temporaryRoot }) {
  const directory = await mkdtemp(join(temporaryRoot, "pit-video-health-"));
  const posterPath = join(directory, "probe.jpg");
  try {
    const ffmpeg = await runProcess(config.ffmpeg, ["-version"], { cwd: directory, signal, outputLimit: 16 * 1024 });
    await runProcess(config.ffprobe, ["-version"], { cwd: directory, signal, outputLimit: 16 * 1024 });
    await runProcess(config.ffmpeg, [
      "-nostdin", "-v", "error", "-xerror",
      "-f", "lavfi", "-i", "color=c=black:s=16x16:d=0.04",
      "-frames:v", "1", "-q:v", "5", "-f", "image2", "-y", posterPath,
    ], { cwd: directory, signal });
    await runProcess(config.ffmpeg, [
      "-nostdin", "-v", "error", "-xerror", "-i", posterPath,
      "-frames:v", "1", "-f", "null", "-",
    ], { cwd: directory, signal });
    const probe = await runProcess(config.ffprobe, [
      "-v", "error", "-f", "image2", "-c:v", "mjpeg",
      "-show_entries", "stream=codec_name,width,height", "-of", "json", posterPath,
    ], { cwd: directory, signal });
    const metadata = parseProbeJson(probe.stdout, "Health poster");
    const stream = metadata.streams?.[0];
    if (metadata.streams?.length !== 1 || stream?.codec_name !== "mjpeg"
        || Number(stream?.width) !== 16 || Number(stream?.height) !== 16) {
      throw serviceError("decoder_unavailable", "Poster encoder/decoder health probe failed.", { status: 503 });
    }
    const firstLine = ffmpeg.stdout.split(/\r?\n/, 1)[0].replace(/[^A-Za-z0-9 ._+-]/g, "").slice(0, 80);
    return { ffmpegVersion: firstLine || "ffmpeg" };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function readRequestBody(req, maxBytes = REQUEST_MAX_BYTES) {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && (declared < 0 || declared > maxBytes)) {
    throw serviceError("request_too_large", "Request body is too large.", { status: 413 });
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.byteLength;
    if (size > maxBytes) throw serviceError("request_too_large", "Request body is too large.", { status: 413 });
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, size).toString("utf8");
}

function sendJson(res, status, body, headers = {}) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(body);
}

function sendUnsignedError(res, status) {
  sendJson(res, status, JSON.stringify({ ok: false }));
}

function sendSigned(res, { config, path, requestNonce, status, payload }) {
  const signed = signVideoVerifierResponse({
    secret: config.secret,
    path,
    requestNonce,
    payload,
  });
  sendJson(res, status, signed.body, signed.headers);
}

function safeFailurePayload(error) {
  // No decoder stderr, filenames, source URL, query string, object key, or
  // user-controlled metadata crosses this boundary.
  const code = /^[a-z_]{2,40}$/.test(String(error?.code || "")) ? error.code : "verification_failed";
  return { ok: false, code, sourceAdmissionRevision: VIDEO_VERIFIER_SOURCE_ADMISSION_REVISION };
}

function makeNonceLedger() {
  const values = new Map();
  return {
    reserve(nonce, at) {
      for (const [key, expiresAt] of values) {
        if (expiresAt <= at) values.delete(key);
      }
      if (values.has(nonce)) return false;
      while (values.size >= NONCE_CACHE_MAX) values.delete(values.keys().next().value);
      values.set(nonce, at + NONCE_TTL_MS);
      return true;
    },
    size() { return values.size; },
  };
}

export function createVideoVerifierService({
  env = process.env,
  fetchImpl = globalThis.fetch,
  runProcess = runVerifierProcess,
  temporaryRoot = tmpdir(),
  clock = () => Date.now(),
  verifyJob = runVideoVerifierJob,
  prerequisiteCheck = prerequisiteProbe,
  log = null,
} = {}) {
  const config = getVideoVerifierServiceConfig(env);
  const nonces = makeNonceLedger();
  const shutdown = new AbortController();
  let activeJob = null;
  let prerequisiteInFlight = null;
  let prerequisite = { checkedAt: 0, ffmpegVersion: null };

  const prerequisites = async (signal) => {
    const at = clock();
    if (prerequisite.checkedAt && at - prerequisite.checkedAt <= HEALTH_FRESH_MS) return prerequisite;
    if (activeJob) throw serviceError("busy", "Verifier is busy.", { status: 429 });
    if (prerequisiteInFlight) return prerequisiteInFlight;
    const probeSignal = AbortSignal.any([shutdown.signal, signal, AbortSignal.timeout(5_000)]);
    prerequisiteInFlight = prerequisiteCheck(config, { runProcess, signal: probeSignal, temporaryRoot })
      .then((result) => {
        prerequisite = { checkedAt: clock(), ffmpegVersion: result.ffmpegVersion };
        return prerequisite;
      })
      .finally(() => { prerequisiteInFlight = null; });
    return prerequisiteInFlight;
  };

  const handler = async (req, res) => {
    const path = String(req.url || "").split("?", 1)[0];
    if (req.method !== "POST" || !new Set(["/v2/health", "/v2/verify"]).has(path)) {
      sendUnsignedError(res, 404);
      return;
    }
    if (!config.configured || String(req.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase() !== "application/json") {
      sendUnsignedError(res, 503);
      return;
    }
    const requestAbort = new AbortController();
    const abortRequest = () => {
      if (!requestAbort.signal.aborted) requestAbort.abort(new Error("Verifier caller disconnected."));
    };
    req.once("aborted", abortRequest);
    res.once("close", () => {
      if (!res.writableEnded) abortRequest();
    });
    if (req.aborted || res.destroyed) {
      abortRequest();
      return;
    }
    let rawBody;
    let authenticated;
    try {
      rawBody = await readRequestBody(req);
      authenticated = verifyVideoVerifierRequest({
        secret: config.secret,
        path,
        body: rawBody,
        headers: req.headers,
        at: clock(),
      });
    } catch (error) {
      sendUnsignedError(res, Number(error?.status) || 401);
      return;
    }
    if (!nonces.reserve(authenticated.nonce, clock())) {
      sendSigned(res, {
        config,
        path,
        requestNonce: authenticated.nonce,
        status: 409,
        payload: { ok: false, code: "replay" },
      });
      return;
    }
    if (requestAbort.signal.aborted || req.aborted || res.destroyed) return;
    try {
      if (path === "/v2/health") {
        const ready = await prerequisites(requestAbort.signal);
        sendSigned(res, {
          config,
          path,
          requestNonce: authenticated.nonce,
          status: 200,
          payload: {
            ok: true,
            protocol: VIDEO_VERIFIER_PROTOCOL_VERSION,
            pipeline: VIDEO_VERIFIER_PIPELINE_VERSION,
            sourceAdmissionRevision: VIDEO_VERIFIER_SOURCE_ADMISSION_REVISION,
            decoder: { ffmpeg: true, ffprobe: true, version: ready.ffmpegVersion },
            poster: { generated: true, decoded: true },
            storage: { privateInput: true, sanitizedOutput: true },
            sourceTypes: [...VIDEO_VERIFIER_SOURCE_CONTENT_TYPES],
            sourceCodecs: Object.fromEntries(VIDEO_VERIFIER_SOURCE_CONTENT_TYPES.map((type) => [
              type,
              [...VIDEO_VERIFIER_SOURCE_CODECS[type]],
            ])),
            universalAdmission: VIDEO_VERIFIER_UNIVERSAL_ADMISSION,
            universalSourceTypes: [...VIDEO_VERIFIER_UNIVERSAL_SOURCE_TYPES],
            concurrency: 1,
          },
        });
        return;
      }
      if (activeJob || prerequisiteInFlight) {
        log?.("busy: a clip arrived while another was converting");
        sendSigned(res, {
          config,
          path,
          requestNonce: authenticated.nonce,
          status: 429,
          payload: { ok: false, code: "busy" },
        });
        return;
      }
      // Validate the full fixed-origin capability before reserving the only
      // decoder slot, so malformed authenticated requests do not block a valid
      // clip for the job timeout.
      validateVideoVerifierJob(authenticated.payload, config);
      const jobAbort = new AbortController();
      const abortJob = () => {
        if (!jobAbort.signal.aborted) jobAbort.abort(requestAbort.signal.reason || shutdown.signal.reason);
      };
      requestAbort.signal.addEventListener("abort", abortJob, { once: true });
      shutdown.signal.addEventListener("abort", abortJob, { once: true });
      const signal = AbortSignal.any([jobAbort.signal, AbortSignal.timeout(JOB_TIMEOUT_MS)]);
      log?.(`start ${String(authenticated.payload?.object?.contentType || "video")} `
        + `${Math.round(Number(authenticated.payload?.object?.byteSize) / 1_048_576 * 10) / 10} MiB`
        + `${authenticated.payload?.admission ? " (any format)" : ""}`);
      const promise = verifyJob(authenticated.payload, {
        config,
        fetchImpl,
        runProcess,
        signal,
        temporaryRoot,
        log,
      });
      activeJob = { promise, abort: abortJob };
      try {
        const result = await promise;
        sendSigned(res, {
          config,
          path,
          requestNonce: authenticated.nonce,
          status: 200,
          payload: result,
        });
      } finally {
        requestAbort.signal.removeEventListener("abort", abortJob);
        shutdown.signal.removeEventListener("abort", abortJob);
        if (activeJob?.promise === promise) activeJob = null;
      }
    } catch (error) {
      if (!requestAbort.signal.aborted && !res.destroyed && !res.writableEnded) {
        const status = [409, 413, 422, 429, 503].includes(Number(error?.status)) ? Number(error.status) : 503;
        sendSigned(res, {
          config,
          path,
          requestNonce: authenticated.nonce,
          status,
          payload: safeFailurePayload(error),
        });
      }
    }
  };

  const server = createServer((req, res) => {
    handler(req, res).catch(() => sendUnsignedError(res, 503));
  });
  return {
    config,
    server,
    handler,
    status: () => ({
      configured: config.configured,
      active: !!activeJob,
      nonceCount: nonces.size(),
      prerequisitesCheckedAt: prerequisite.checkedAt || null,
    }),
    listen(port = config.port, host = "0.0.0.0") {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.removeListener("error", reject);
          resolve(server.address());
        });
      });
    },
    async close() {
      if (!shutdown.signal.aborted) shutdown.abort(new Error("Video verifier is shutting down."));
      activeJob?.abort?.();
      if (!server.listening) return;
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

// The self-test's own runner keeps FFmpeg's error text so a failed image build
// names the exact step and reason. Only generated test clips pass through it.
function selfTestRunner(executable, args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env: safeChildEnvironment(cwd), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const out = Buffer.concat(stdout).toString("utf8");
      const err = Buffer.concat(stderr).toString("utf8");
      if (code === 0) { resolve({ stdout: out, stderr: err }); return; }
      const step = `${executable.split("/").pop()} ${args.filter((arg) => !String(arg).startsWith("/")).slice(0, 40).join(" ")}`;
      reject(Object.assign(new Error(`${step} (exit ${code}): ${err.trim().split("\n").slice(-6).join(" | ")}`), { code: "decode_failed", status: 422 }));
    });
  });
}

// Run by the image build (`--self-test`). FFmpeg makes small clips in formats
// the MP4/MOV path rejects and each is converted exactly as a member upload
// would be. A wrong command fails the build, so Render keeps the running worker.
export async function runVideoVerifierSelfTest({
  config = {
    ffmpeg: cleanExecutable(process.env.PIT_FFMPEG_PATH, "ffmpeg"),
    ffprobe: cleanExecutable(process.env.PIT_FFPROBE_PATH, "ffprobe"),
  },
  runProcess = selfTestRunner,
  temporaryRoot = tmpdir(),
} = {}) {
  const directory = await mkdtemp(join(temporaryRoot, "pit-video-selftest-"));
  const samples = [
    { name: "clip.avi", contentType: "video/x-msvideo", encode: ["-c:v", "mpeg4", "-c:a", "pcm_s16le"] },
    { name: "clip.mkv", contentType: "video/x-matroska", encode: ["-c:v", "mpeg4", "-c:a", "ac3"] },
    { name: "clip.webm", contentType: "video/webm", encode: ["-c:v", "mpeg4", "-c:a", "ac3", "-f", "matroska"] },
    {
      name: "clip.mpg",
      contentType: "video/mpeg",
      size: "720x480",
      // FFmpeg 9 removed `-top`; setfield marks the frames top-field-first.
      encode: ["-vf", "setsar=32/27,setfield=tff", "-c:v", "mpeg2video", "-flags", "+ilme+ildct", "-c:a", "mp2"],
    },
    {
      // Shaped like a clip saved from TikTok or a phone: portrait H.264/AAC in
      // MP4 at 44.1 kHz. It must take the fast repackage path.
      name: "portrait.mp4",
      contentType: "video/mp4",
      size: "360x640",
      rate: 30,
      encode: ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-profile:v", "high", "-c:a", "aac"],
      strategy: "remux",
    },
    {
      // The same clip with 4:3 non-square pixels cannot be copied as is.
      name: "anamorphic.mp4",
      contentType: "video/mp4",
      size: "480x360",
      encode: ["-vf", "setsar=4/3", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac"],
      strategy: "transcode",
    },
  ];
  const results = [];
  try {
    for (const sample of samples) {
      const sourcePath = join(directory, sample.name);
      await runProcess(config.ffmpeg, [
        "-nostdin", "-v", "error",
        "-f", "lavfi", "-i", `testsrc2=size=${sample.size || "320x240"}:rate=${sample.rate || 25}`,
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
        "-t", "1", ...sample.encode, "-y", sourcePath,
      ], { cwd: directory });
      const video = await probeUniversalVideo(sourcePath, sample.contentType, config, { runProcess, directory });
      const deliveryPath = join(directory, `${sample.name}.delivery.mp4`);
      const skipped = [];
      const delivery = await createSanitizedDelivery(sourcePath, deliveryPath, video, null, config, {
        runProcess, directory, log: (line) => skipped.push(line),
      });
      if (delivery.video.codec !== "h264" || delivery.video.audioCodec !== "aac") {
        throw new Error(`${sample.name} did not convert to H.264/AAC.`);
      }
      if (sample.strategy && delivery.strategy !== sample.strategy) {
        throw new Error(`${sample.name} took the ${delivery.strategy} path instead of ${sample.strategy}. ${skipped.join(" ")}`);
      }
      await generateAndVerifyPoster(deliveryPath, join(directory, `${sample.name}.jpg`), {
        poster: { timeMs: videoVerifierUniversalPosterTimeMs(500, delivery.video.durationMs), maxBytes: POSTER_MAX_BYTES, maxEdge: POSTER_MAX_EDGE },
      }, delivery.video, config, { runProcess, directory });
      results.push({ name: sample.name, width: delivery.video.width, height: delivery.video.height, strategy: delivery.strategy });
    }
    return results;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function main() {
  if (process.argv.includes("--self-test")) {
    const results = await runVideoVerifierSelfTest().catch((error) => {
      const causes = [];
      for (let cause = error; cause; cause = cause.cause) causes.push(cause.message);
      throw new Error(`self-test failed: ${causes.join(" <- caused by: ")}`);
    });
    process.stdout.write(`[video-verifier] self-test converted ${results.map((item) => `${item.name} ${item.width}x${item.height} by ${item.strategy}`).join(", ")}\n`);
    return;
  }
  const service = createVideoVerifierService({
    log: (line) => process.stdout.write(`[video-verifier] ${line}\n`),
  });
  if (!service.config.configured) {
    // Configuration names are not emitted because even a missing-name list can
    // reveal deployment topology. Render records the nonzero exit.
    process.stderr.write("[video-verifier] configuration invalid\n");
    process.exitCode = 1;
    return;
  }
  await service.listen();
  process.stdout.write(`[video-verifier] listening on port ${service.config.port}\n`);
  const stop = async () => {
    await service.close();
    process.exit(0);
  };
  process.once("SIGTERM", () => { void stop(); });
  process.once("SIGINT", () => { void stop(); });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`[video-verifier] ${error?.message || "failed"}\n`);
    process.exitCode = 1;
  });
}
