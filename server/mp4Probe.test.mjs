import assert from "node:assert/strict";
import test from "node:test";

import { ApiError } from "./errors.js";
import {
  MAX_CONCURRENT_MP4_STRUCTURAL_PROBES,
  verifyMp4Compatibility,
} from "./mp4Probe.js";

const MEBIBYTE = 1024 * 1024;

const ENV = Object.freeze({
  NODE_ENV: "test",
  MEDIA_ENDPOINT: "https://storage.example.test",
  MEDIA_BUCKET: "pit-media",
  MEDIA_REGION: "auto",
  MEDIA_ACCESS_KEY_ID: "test-access-key",
  MEDIA_SECRET_ACCESS_KEY: "test-secret-key",
  MEDIA_PUBLIC_BASE_URL: "https://media.example.test",
});

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
}

function u64(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(value));
  return buffer;
}

function box(type, ...payloads) {
  const payload = Buffer.concat(payloads.map((value) => Buffer.from(value)));
  const header = Buffer.alloc(8);
  header.writeUInt32BE(header.length + payload.length, 0);
  header.write(type, 4, 4, "latin1");
  return Buffer.concat([header, payload]);
}

function declaredBox(type, size) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(size, 0);
  header.write(type, 4, 4, "latin1");
  return header;
}

function fullBox(type, version, ...payloads) {
  return box(type, Buffer.from([version, 0, 0, 0]), ...payloads);
}

function descriptor(tag, ...payloads) {
  const payload = Buffer.concat(payloads.map((value) => Buffer.from(value)));
  const encodedLength = [];
  let remaining = payload.length;
  do {
    encodedLength.unshift(remaining & 0x7f);
    remaining >>= 7;
  } while (remaining);
  for (let index = 0; index < encodedLength.length - 1; index += 1) encodedLength[index] |= 0x80;
  return Buffer.concat([Buffer.from([tag, ...encodedLength]), payload]);
}

function packedBits(fields) {
  const bits = fields.flatMap(({ value, width }) => (
    Array.from({ length: width }, (_, index) => (value >> (width - index - 1)) & 1)
  ));
  while (bits.length % 8) bits.push(0);
  const output = Buffer.alloc(bits.length / 8);
  bits.forEach((bit, index) => { output[Math.floor(index / 8)] |= bit << (7 - (index % 8)); });
  return output;
}

function unsignedGolombBits(value) {
  const encoded = (value + 1).toString(2);
  return [...Array(encoded.length - 1).fill(0), ...[...encoded].map(Number)];
}

function packBitArray(bits) {
  const padded = [...bits];
  while (padded.length % 8) padded.push(0);
  const output = Buffer.alloc(padded.length / 8);
  padded.forEach((bit, index) => { output[Math.floor(index / 8)] |= bit << (7 - (index % 8)); });
  return output;
}

function makeEsds({
  objectType = 0x40,
  audioObjectType = 2,
  frequencyIndex = 3,
  channels = 2,
  gasFlags = 0,
  streamFlags = 0x15,
  audioConfigSuffix = Buffer.alloc(0),
} = {}) {
  const audioConfig = Buffer.concat([packedBits([
    { value: audioObjectType, width: 5 },
    { value: frequencyIndex, width: 4 },
    { value: channels, width: 4 },
    { value: gasFlags, width: 3 },
  ]), Buffer.from(audioConfigSuffix)]);
  const specific = descriptor(0x05, audioConfig);
  const decoder = descriptor(0x04,
    Buffer.from([objectType, streamFlags, 0, 0, 0]),
    u32(128_000), u32(128_000), specific);
  const slConfig = descriptor(0x06, Buffer.from([2]));
  const elementary = descriptor(0x03, Buffer.from([0, 1, 0]), decoder, slConfig);
  return fullBox("esds", 0, elementary);
}

function makeFtyp({ majorBrand = "isom", compatibleBrands = ["isom", "iso6", "mp41"] } = {}) {
  return box("ftyp", Buffer.from(majorBrand), u32(0x200),
    Buffer.from(compatibleBrands.join("")));
}

function makeMvhd({ version = 0, timescale = 1_000, duration = 5_001 } = {}) {
  if (version === 1) {
    return fullBox("mvhd", 1, u64(0), u64(0), u32(timescale), u64(duration));
  }
  return fullBox("mvhd", 0, u32(0), u32(0), u32(timescale), u32(duration));
}

function makeMdhd({ version = 0, timescale = 1_000, duration = 5_001 } = {}) {
  if (version === 1) {
    return fullBox("mdhd", 1, u64(0), u64(0), u32(timescale), u64(duration));
  }
  return fullBox("mdhd", 0, u32(0), u32(0), u32(timescale), u32(duration));
}

function makeStts({ sampleCount = 1, sampleDelta = 5_001 } = {}) {
  return fullBox("stts", 0, u32(1), u32(sampleCount), u32(sampleDelta));
}

function makeStsz({ sampleSize = 6, sampleCount = 1 } = {}) {
  return fullBox("stsz", 0, u32(sampleSize), u32(sampleCount));
}

function makeStsc({ sampleCount = 1, descriptionIndex = 1 } = {}) {
  return fullBox("stsc", 0, u32(1), u32(1), u32(sampleCount), u32(descriptionIndex));
}

function makeStco({ chunkOffset = 0 } = {}) {
  return fullBox("stco", 0, u32(1), u32(chunkOffset));
}

function makeSps({
  profile,
  level,
  width,
  height,
  codedWidth = width,
  codedHeight = height,
  chromaFormat = 1,
  progressive = true,
} = {}) {
  const safeWidth = width >= 1 && width <= 4_096 ? width : 1_920;
  const safeHeight = height >= 1 && height <= 2_160 ? height : 1_080;
  const safeCodedWidth = codedWidth >= safeWidth && codedWidth <= 4_096 ? codedWidth : safeWidth;
  const safeCodedHeight = codedHeight >= safeHeight && codedHeight <= 2_176 ? codedHeight : safeHeight;
  const widthInMbs = Math.ceil(safeCodedWidth / 16);
  const heightInMapUnits = Math.ceil(safeCodedHeight / (progressive ? 16 : 32));
  const cropRight = (widthInMbs * 16 - safeWidth) / 2;
  const cropBottom = (heightInMapUnits * 16 * (progressive ? 1 : 2) - safeHeight) / (progressive ? 2 : 4);
  const canRepresentCrop = Number.isInteger(cropRight) && Number.isInteger(cropBottom);
  const bits = [...unsignedGolombBits(0)]; // seq_parameter_set_id
  if (profile === 100) {
    bits.push(...unsignedGolombBits(chromaFormat));
    bits.push(...unsignedGolombBits(0), ...unsignedGolombBits(0), 0, 0);
  }
  bits.push(
    ...unsignedGolombBits(0), // log2_max_frame_num_minus4
    ...unsignedGolombBits(0), // pic_order_cnt_type
    ...unsignedGolombBits(0), // log2_max_pic_order_cnt_lsb_minus4
    ...unsignedGolombBits(1), // max_num_ref_frames
    0,
    ...unsignedGolombBits(widthInMbs - 1),
    ...unsignedGolombBits(heightInMapUnits - 1),
    progressive ? 1 : 0, // frame_mbs_only_flag
    ...(progressive ? [] : [0]), // mb_adaptive_frame_field_flag
    1, // direct_8x8_inference_flag
    canRepresentCrop && (cropRight || cropBottom) ? 1 : 0,
  );
  if (canRepresentCrop && (cropRight || cropBottom)) {
    bits.push(...unsignedGolombBits(0), ...unsignedGolombBits(cropRight),
      ...unsignedGolombBits(0), ...unsignedGolombBits(cropBottom));
  }
  bits.push(0, 1); // vui_parameters_present_flag, rbsp_stop_one_bit
  return Buffer.concat([Buffer.from([0x67, profile, 0, level]), packBitArray(bits)]);
}

function makeAvcC({
  inBandOnly = false,
  profile = 66,
  level = 40,
  width = 1_920,
  height = 1_080,
  codedWidth = width,
  codedHeight = height,
  progressive = true,
  chromaFormat = 1,
} = {}) {
  if (inBandOnly) return box("avcC", Buffer.from([1, profile, 0, level, 0xff, 0xe0, 0]));
  const sps = makeSps({ profile, level, width, height, codedWidth, codedHeight, chromaFormat, progressive });
  // AVCDecoderConfigurationRecord: one tiny SPS and one tiny PPS. The probe is
  // checking structure and codec identity, not decoding these test NAL units.
  return box("avcC", Buffer.concat([
    Buffer.from([1, profile, 0, level, 0xff, 0xe1]),
    Buffer.from([(sps.length >> 8) & 0xff, sps.length & 0xff]), sps,
    Buffer.from([1, 0, 1, 0x68]),
  ]));
}

function makeHvcC({ profile = 1, level = 120, bitDepthMinus8 = 0 } = {}) {
  const header = Buffer.alloc(23);
  header[0] = 1;
  header[1] = profile & 0x1f;
  header[12] = level;
  header[13] = 0xf0;
  header[15] = 0xfc;
  header[16] = 0xfc | 1;
  header[17] = 0xf8 | bitDepthMinus8;
  header[18] = 0xf8 | bitDepthMinus8;
  header[21] = 0x03; // four-byte NAL lengths
  header[22] = 3;
  const parameterArray = (type) => Buffer.from([
    0x80 | type,
    0, 1,
    0, 3,
    (type << 1) & 0x7e, 1, 0,
  ]);
  return box("hvcC", header, parameterArray(32), parameterArray(33), parameterArray(34));
}

function makeVisualEntry(type = "avc1", {
  includeConfiguration = true,
  inBandOnly = false,
  extraChildren = [],
  width = 1_920,
  height = 1_080,
  spsWidth = width,
  spsHeight = height,
  spsCodedWidth = spsWidth,
  spsCodedHeight = spsHeight,
  progressive = true,
  profile = 66,
  level = 40,
  chromaFormat = 1,
  bitDepthMinus8 = 0,
  dataReferenceIndex = 1,
} = {}) {
  const fixed = Buffer.alloc(78);
  fixed.writeUInt16BE(dataReferenceIndex, 6);
  fixed.writeUInt16BE(width, 24);
  fixed.writeUInt16BE(height, 26);
  const configuration = type === "hvc1"
    ? makeHvcC({ profile: profile === 66 ? 1 : profile, level, bitDepthMinus8 })
    : makeAvcC({
      inBandOnly, profile, level, width: spsWidth, height: spsHeight,
      codedWidth: spsCodedWidth, codedHeight: spsCodedHeight, progressive, chromaFormat,
    });
  return box(type, fixed, ...(includeConfiguration ? [configuration] : []), ...extraChildren);
}

function makeAudioEntry(type = "mp4a", {
  extraChildren = [],
  includeEsds = true,
  objectType = 0x40,
  audioObjectType = 2,
  frequencyIndex = 3,
  channels = 2,
  configChannels = channels,
  sampleRate = 48_000,
  gasFlags = 0,
  dataReferenceIndex = 1,
  streamFlags = 0x15,
  audioConfigSuffix = Buffer.alloc(0),
} = {}) {
  const fixed = Buffer.alloc(28);
  fixed.writeUInt16BE(dataReferenceIndex, 6);
  fixed.writeUInt16BE(0, 8);
  fixed.writeUInt16BE(channels, 16);
  fixed.writeUInt16BE(16, 18);
  fixed.writeUInt32BE(sampleRate * 65_536, 24);
  const esds = includeEsds ? [makeEsds({
    objectType, audioObjectType, frequencyIndex, channels: configChannels, gasFlags,
    streamFlags, audioConfigSuffix,
  })] : [];
  return box(type, fixed, ...esds, ...extraChildren);
}

function makeTrack(handlerType, entries, {
  timescale = 1_000,
  mdhdDuration = 5_001,
  sampleCount = 1,
  sampleDelta = mdhdDuration,
  omitMdhd = false,
  omitStts = false,
  omitStsz = false,
  omitStsc = false,
  omitStco = false,
  sampleSize = 6,
  chunkOffset = 0,
  tableSampleCount = sampleCount,
} = {}) {
  const hdlr = fullBox("hdlr", 0, u32(0), Buffer.from(handlerType));
  const stsd = fullBox("stsd", 0, u32(entries.length), ...entries);
  const timing = omitStts ? [] : [makeStts({ sampleCount, sampleDelta })];
  const sizes = omitStsz ? [] : [makeStsz({ sampleSize, sampleCount: tableSampleCount })];
  const sampleMap = omitStsc ? [] : [makeStsc({ sampleCount: tableSampleCount })];
  const offsets = omitStco ? [] : [makeStco({ chunkOffset })];
  const mediaHeader = omitMdhd ? [] : [makeMdhd({ timescale, duration: mdhdDuration })];
  return box("trak", box("mdia", ...mediaHeader, hdlr,
    box("minf", box("stbl", stsd, ...timing, ...sizes, ...sampleMap, ...offsets))));
}

function makeDiscardedTrack(handlerType) {
  const hdlr = fullBox("hdlr", 0, u32(0), Buffer.from(handlerType));
  return box("trak", box("mdia", hdlr));
}

function projectedMovieDuration(movie) {
  const timescale = BigInt(movie.timescale ?? 1_000);
  const duration = BigInt(movie.duration ?? 5_001);
  if (timescale <= 0n || duration <= 0n) return 5_001;
  const milliseconds = (duration * 1_000n + timescale - 1n) / timescale;
  return milliseconds <= 0xffffffffn ? Number(milliseconds) : 5_001;
}

function makeMoov({
  videoEntries = [makeVisualEntry()],
  additionalVideoTracks = [],
  audioEntries = [],
  movie = {},
  videoTiming = {},
  audioTiming = {},
  videoTable = {},
  audioTable = {},
  metadataHandlers = [],
  chunkOffset = 0,
  sampleSize = 6,
} = {}) {
  const defaultDuration = projectedMovieDuration(movie);
  const resolvedVideoTiming = {
    mdhdDuration: defaultDuration, sampleSize, chunkOffset, ...videoTiming, ...videoTable,
  };
  const tracks = [makeTrack("vide", videoEntries, resolvedVideoTiming),
    ...additionalVideoTracks.map((entries) => makeTrack("vide", entries, resolvedVideoTiming))];
  if (audioEntries.length) {
    tracks.push(makeTrack("soun", audioEntries, {
      mdhdDuration: defaultDuration, sampleSize, chunkOffset, ...audioTiming, ...audioTable,
    }));
  }
  tracks.push(...metadataHandlers.map((handlerType) => makeDiscardedTrack(handlerType)));
  return box("moov", makeMvhd(movie), ...tracks);
}

function makeMp4({
  sample = Buffer.from([0, 0, 0, 2, 0x65, 0xb8]),
  mdatPayload = sample,
  omitMdat = false,
  emptyMdat = false,
  chunkOffsetOverride,
  ftyp: ftypOptions,
  ...options
} = {}) {
  const ftyp = makeFtyp(ftypOptions);
  const payload = emptyMdat ? Buffer.alloc(0) : Buffer.from(mdatPayload);
  const provisionalMoov = makeMoov({ ...options, chunkOffset: 0, sampleSize: sample.length });
  const chunkOffset = chunkOffsetOverride ?? (ftyp.length + provisionalMoov.length + 8);
  const moov = makeMoov({ ...options, chunkOffset, sampleSize: sample.length });
  return Buffer.concat([ftyp, moov, ...(omitMdat ? [] : [box("mdat", payload)])]);
}

function responseForRange(bytes, start, end, {
  status = 206,
  contentRange = `bytes ${start}-${end}/${bytes.length}`,
  body = bytes.subarray(start, end + 1),
} = {}) {
  return new Response(body, {
    status,
    headers: {
      "Content-Length": String(body.length),
      "Content-Range": contentRange,
    },
  });
}

function rangeFetch(bytes, {
  mutateResponse,
  expectedIfMatch,
} = {}) {
  const requests = [];
  const fetchImpl = async (url, options) => {
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    const range = options.headers.Range;
    const match = /^bytes=(\d+)-(\d+)$/u.exec(range);
    assert.ok(match, "probe sends an explicit bounded Range header");
    const start = Number(match[1]);
    const end = Number(match[2]);
    assert.ok(start >= 0 && end >= start && end < bytes.length);
    if (expectedIfMatch) assert.equal(options.headers["If-Match"], expectedIfMatch);
    const signed = new URL(url);
    const signedHeaders = decodeURIComponent(signed.searchParams.get("X-Amz-SignedHeaders") || "");
    assert.match(signedHeaders, /(?:^|;)range(?:;|$)/u);
    if (expectedIfMatch) assert.match(signedHeaders, /(?:^|;)if-match(?:;|$)/u);
    requests.push({ start, end, url, options });
    const normal = responseForRange(bytes, start, end);
    return mutateResponse ? mutateResponse({ bytes, start, end, normal, requests }) : normal;
  };
  fetchImpl.requests = requests;
  return fetchImpl;
}

async function verify(bytes, overrides = {}) {
  const fetchImpl = overrides.fetchImpl || rangeFetch(bytes, overrides);
  return verifyMp4Compatibility({
    objectKey: overrides.objectKey || "users/owner/post/source.mp4",
    expectedBytes: bytes.length,
    contentType: overrides.contentType || "video/mp4",
    env: ENV,
    fetchImpl,
    ...(overrides.ifMatch ? { ifMatch: overrides.ifMatch } : {}),
  });
}

function isUnsupported(error) {
  return error instanceof ApiError
    && error.status === 415
    && error.code === "MEDIA_TYPE_UNSUPPORTED"
    && !/users\/|source\.mp4|storage\.example/u.test(error.message);
}

function expectedStructural({
  durationMs = 5_001,
  width = 1_920,
  height = 1_080,
  codedWidth = Math.ceil(width / 16) * 16,
  codedHeight = Math.ceil(height / 16) * 16,
  sampleCount = 1,
} = {}) {
  return { durationMs, width, height, codedWidth, codedHeight, sampleCount };
}

test("coalesces the same stored generation into one structural R2 proof", async () => {
  const bytes = makeMp4();
  const baselineFetch = rangeFetch(bytes, { expectedIfMatch: '"shared-generation"' });
  await verifyMp4Compatibility({
    objectKey: "users/owner/post/shared-source.mp4",
    expectedBytes: bytes.length,
    ifMatch: '"shared-generation"',
    env: ENV,
    fetchImpl: baselineFetch,
  });

  const sharedFetch = rangeFetch(bytes, { expectedIfMatch: '"shared-generation"' });
  const options = {
    objectKey: "users/owner/post/shared-source.mp4",
    expectedBytes: bytes.length,
    ifMatch: '"shared-generation"',
    env: ENV,
    fetchImpl: sharedFetch,
  };
  const [first, second] = await Promise.all([
    verifyMp4Compatibility(options),
    verifyMp4Compatibility(options),
  ]);

  assert.deepEqual(first, expectedStructural());
  assert.deepEqual(second, expectedStructural());
  assert.equal(sharedFetch.requests.length, baselineFetch.requests.length,
    "duplicate finalization shares the exact same bounded range work");
});

test("an immediate same-generation retry does not join an already-aborted shared proof", async () => {
  const bytes = makeMp4();
  const regularFetch = rangeFetch(bytes, { expectedIfMatch: '"retry-generation"' });
  let firstFetchStarted;
  const started = new Promise((resolve) => { firstFetchStarted = resolve; });
  let rejectFirstFetch;
  let calls = 0;
  const fetchImpl = (url, options) => {
    calls += 1;
    if (calls === 1) {
      firstFetchStarted();
      return new Promise((_resolve, reject) => { rejectFirstFetch = reject; });
    }
    return regularFetch(url, options);
  };
  const options = {
    objectKey: "users/owner/post/retried-source.mp4",
    expectedBytes: bytes.length,
    ifMatch: '"retry-generation"',
    env: ENV,
    fetchImpl,
  };
  const controller = new AbortController();
  const first = verifyMp4Compatibility({ ...options, signal: controller.signal });
  await started;
  controller.abort();
  await assert.rejects(first, (error) => error?.name === "AbortError");

  const retried = await verifyMp4Compatibility(options);
  assert.deepEqual(retried, expectedStructural());
  assert.ok(calls > 1, "the retry starts a fresh proof instead of joining cancelled work");

  rejectFirstFetch(new DOMException("Aborted", "AbortError"));
  await new Promise((resolve) => setImmediate(resolve));
});

test("global admission rejects excess distinct probes before R2 and recovers without disabling uploads", async () => {
  assert.ok(MAX_CONCURRENT_MP4_STRUCTURAL_PROBES >= 1);
  const bytes = makeMp4();
  let fetchCalls = 0;
  let markAllStarted;
  const allStarted = new Promise((resolve) => { markAllStarted = resolve; });
  const blockedFetch = async (_url, options) => {
    fetchCalls += 1;
    if (fetchCalls === MAX_CONCURRENT_MP4_STRUCTURAL_PROBES) markAllStarted();
    return new Promise((_resolve, reject) => {
      const onAbort = () => reject(options.signal?.reason || new DOMException("Aborted", "AbortError"));
      if (options.signal?.aborted) onAbort();
      else options.signal?.addEventListener("abort", onAbort, { once: true });
    });
  };
  const controllers = Array.from(
    { length: MAX_CONCURRENT_MP4_STRUCTURAL_PROBES },
    () => new AbortController(),
  );
  const active = controllers.map((controller, index) => verifyMp4Compatibility({
    objectKey: `users/owner/post/active-${index}.mp4`,
    expectedBytes: bytes.length,
    ifMatch: `"active-generation-${index}"`,
    env: ENV,
    fetchImpl: blockedFetch,
    signal: controller.signal,
  }));

  await allStarted;
  assert.equal(fetchCalls, MAX_CONCURRENT_MP4_STRUCTURAL_PROBES);
  const outcome = await Promise.race([
    verifyMp4Compatibility({
      objectKey: "users/owner/post/excess.mp4",
      expectedBytes: bytes.length,
      ifMatch: '"excess-generation"',
      env: ENV,
      fetchImpl: blockedFetch,
    }).then(
      () => ({ type: "accepted" }),
      (error) => ({ type: "rejected", error }),
    ),
    new Promise((resolve) => setImmediate(() => resolve({ type: "waited" }))),
  ]);
  assert.equal(outcome.type, "rejected", "overload settles before another event-loop turn");
  assert.ok(outcome.error instanceof ApiError);
  assert.equal(outcome.error.status, 429);
  assert.equal(outcome.error.code, "RATE_LIMITED");
  assert.equal(fetchCalls, MAX_CONCURRENT_MP4_STRUCTURAL_PROBES,
    "rejected overload performs no storage request");

  controllers.forEach((controller) => controller.abort());
  await Promise.allSettled(active);
  await new Promise((resolve) => setImmediate(resolve));

  const recoveryFetch = rangeFetch(bytes);
  const recovered = await verifyMp4Compatibility({
    objectKey: "users/owner/post/recovered.mp4",
    expectedBytes: bytes.length,
    env: ENV,
    fetchImpl: recoveryFetch,
  });
  assert.deepEqual(recovered, expectedStructural());
  assert.ok(recoveryFetch.requests.length > 0, "a released slot admits the next upload normally");
});

test("accepts AVC video with optional MPEG-4 audio and returns ceil-rounded mvhd duration", async () => {
  const bytes = makeMp4({ audioEntries: [makeAudioEntry()], movie: { timescale: 1_000, duration: 5_001 } });
  const result = await verify(bytes);
  assert.deepEqual(result, expectedStructural());
});

test("parses version-one mvhd duration without precision loss", async () => {
  const bytes = makeMp4({ movie: { version: 1, timescale: 90_000, duration: 90_001 } });
  assert.deepEqual(await verify(bytes), expectedStructural({ durationMs: 1_001 }));
});

test("accepts only conservative ISO-MP4 brands and rejects QuickTime or streaming containers", async (context) => {
  for (const majorBrand of ["isom", "mp41", "mp42"]) {
    await context.test(`accept-${majorBrand}`, async () => {
      const bytes = makeMp4({ ftyp: { majorBrand, compatibleBrands: [majorBrand, "avc1"] } });
      assert.deepEqual(await verify(bytes), expectedStructural());
    });
  }
  for (const fixture of [
    { label: "quicktime", ftyp: { majorBrand: "qt  ", compatibleBrands: ["qt  "] } },
    { label: "unknown-major", ftyp: { majorBrand: "zzzz", compatibleBrands: ["isom"] } },
    { label: "unknown-compatible", ftyp: { majorBrand: "isom", compatibleBrands: ["isom", "zzzz"] } },
  ]) {
    await context.test(`reject-${fixture.label}`, async () => {
      await assert.rejects(() => verify(makeMp4({ ftyp: fixture.ftyp })), isUnsupported);
    });
  }
  await context.test("reject-fragmented-marker", async () => {
    const bytes = Buffer.concat([makeMp4(), box("moof", Buffer.alloc(8))]);
    await assert.rejects(() => verify(bytes), isUnsupported);
  });
});

test("QuickTime mode binds the MOV key/type and admits bounded iPhone AVC or HEVC structure", async () => {
  const h264 = makeMp4({
    ftyp: { majorBrand: "qt  ", compatibleBrands: ["qt  "] },
    metadataHandlers: ["meta"],
  });
  assert.deepEqual(await verify(h264, {
    objectKey: "users/owner/post/iphone-avc.mov",
    contentType: "video/quicktime",
  }), {
    ...expectedStructural(),
    sourceContainer: "quicktime",
    sourceCodec: "h264",
  });

  const hevcSample = Buffer.from([0, 0, 0, 3, 19 << 1, 1, 0]);
  const hevc = makeMp4({
    ftyp: { majorBrand: "qt  ", compatibleBrands: ["qt  "] },
    sample: hevcSample,
    videoEntries: [makeVisualEntry("hvc1", { profile: 1, level: 120 })],
  });
  assert.deepEqual(await verify(hevc, {
    objectKey: "users/owner/post/iphone-hevc.mov",
    contentType: "video/quicktime",
  }), {
    ...expectedStructural(),
    sourceContainer: "quicktime",
    sourceCodec: "hevc",
  });

  let fetches = 0;
  await assert.rejects(() => verifyMp4Compatibility({
    objectKey: "users/owner/post/type-confusion.mp4",
    contentType: "video/quicktime",
    expectedBytes: h264.length,
    env: ENV,
    fetchImpl: async () => { fetches += 1; },
  }), isUnsupported);
  assert.equal(fetches, 0, "a MOV claim cannot be paired with an MP4 object key");
});

test("ISO-MP4 mode admits only bounded hvc1 Main or Main 10 structure", async (context) => {
  const hevcSample = Buffer.from([0, 0, 0, 3, 19 << 1, 1, 0]);
  for (const fixture of [
    { label: "main-8-bit", profile: 1, bitDepthMinus8: 0 },
    { label: "main10-10-bit", profile: 2, bitDepthMinus8: 1 },
  ]) {
    await context.test(fixture.label, async () => {
      const bytes = makeMp4({
        ftyp: { majorBrand: "mp42", compatibleBrands: ["isom", "iso6", "hvc1", "mp42"] },
        sample: hevcSample,
        videoEntries: [makeVisualEntry("hvc1", {
          profile: fixture.profile,
          level: 120,
          bitDepthMinus8: fixture.bitDepthMinus8,
        })],
      });
      assert.deepEqual(await verify(bytes, {
        objectKey: `users/owner/post/${fixture.label}.mp4`,
        contentType: "video/mp4",
      }), {
        ...expectedStructural(),
        sourceCodec: "hevc",
      });
    });
  }
});

test("rejects avc3 because its in-band configuration is outside the bounded probe", async () => {
  const bytes = makeMp4({ videoEntries: [makeVisualEntry("avc3", { inBandOnly: true })] });
  await assert.rejects(() => verify(bytes), isUnsupported);
});

test("accepts only broadly compatible 8-bit AVC profiles and levels", async (context) => {
  const allowed = [
    { label: "baseline", profile: 66 },
    { label: "main", profile: 77 },
    { label: "high-420-8bit", profile: 100 },
  ];
  for (const fixture of allowed) {
    await context.test(fixture.label, async () => {
      const bytes = makeMp4({ videoEntries: [makeVisualEntry("avc1", fixture)] });
      assert.deepEqual(await verify(bytes), expectedStructural());
    });
  }
  for (const profile of [44, 110, 122, 244]) {
    await context.test(`reject-profile-${profile}`, async () => {
      const bytes = makeMp4({ videoEntries: [makeVisualEntry("avc1", { profile })] });
      await assert.rejects(() => verify(bytes), isUnsupported);
    });
  }
  await context.test("reject-extended-profile", async () => {
    const bytes = makeMp4({ videoEntries: [makeVisualEntry("avc1", { profile: 88 })] });
    await assert.rejects(() => verify(bytes), isUnsupported);
  });
  await context.test("reject-unsupported-level", async () => {
    const bytes = makeMp4({ videoEntries: [makeVisualEntry("avc1", { level: 62 })] });
    await assert.rejects(() => verify(bytes), isUnsupported);
  });
  await context.test("reject-level-5.2", async () => {
    const bytes = makeMp4({ videoEntries: [makeVisualEntry("avc1", { level: 52 })] });
    await assert.rejects(() => verify(bytes), isUnsupported);
  });
  await context.test("reject-interlaced-sps", async () => {
    const bytes = makeMp4({ videoEntries: [makeVisualEntry("avc1", { progressive: false })] });
    await assert.rejects(() => verify(bytes), isUnsupported);
  });
  await context.test("reject-level-too-small-for-frame", async () => {
    const bytes = makeMp4({ videoEntries: [makeVisualEntry("avc1", { level: 30 })] });
    await assert.rejects(() => verify(bytes), isUnsupported);
  });
  await context.test("reject-high-422-signalling", async () => {
    // High profile with chroma_format_idc=2 in its SPS, despite the profile
    // byte claiming ordinary High.
    const bytes = makeMp4({
      videoEntries: [makeVisualEntry("avc1", { profile: 100, chromaFormat: 2 })],
    });
    await assert.rejects(() => verify(bytes), isUnsupported);
  });
});

test("returns bounded structural dimensions and rejects inconsistent entries or tracks", async (context) => {
  const dimensions = { width: 3_840, height: 2_160 };
  const bytes = makeMp4({ videoEntries: [makeVisualEntry("avc1", { ...dimensions, level: 51 })] });
  assert.deepEqual(await verify(bytes), expectedStructural({ ...dimensions }));

  for (const invalid of [{ width: 0, height: 1_080 }, { width: 4_097, height: 2_160 }, { width: 3_840, height: 2_161 }]) {
    await context.test(`reject-${invalid.width}x${invalid.height}`, async () => {
      const invalidBytes = makeMp4({ videoEntries: [makeVisualEntry("avc1", invalid)] });
      await assert.rejects(() => verify(invalidBytes), isUnsupported);
    });
  }
  await context.test("inconsistent-sample-entries", async () => {
    const invalidBytes = makeMp4({
      videoEntries: [makeVisualEntry(), makeVisualEntry("avc1", { width: 1_280, height: 720 })],
    });
    await assert.rejects(() => verify(invalidBytes), isUnsupported);
  });
  await context.test("inconsistent-video-tracks", async () => {
    const invalidBytes = makeMp4({
      additionalVideoTracks: [[makeVisualEntry("avc1", { width: 1_280, height: 720 })]],
    });
    await assert.rejects(() => verify(invalidBytes), isUnsupported);
  });
  await context.test("sample-entry-cannot-spoof-smaller-than-sps", async () => {
    const invalidBytes = makeMp4({
      videoEntries: [makeVisualEntry("avc1", {
        width: 1_920,
        height: 1_080,
        spsWidth: 3_840,
        spsHeight: 2_160,
        level: 51,
      })],
    });
    await assert.rejects(() => verify(invalidBytes), isUnsupported);
  });
});

test("requires the local data reference for every audio and video entry", async (context) => {
  await context.test("video", async () => {
    const bytes = makeMp4({ videoEntries: [makeVisualEntry("avc1", { dataReferenceIndex: 2 })] });
    await assert.rejects(() => verify(bytes), isUnsupported);
  });
  await context.test("audio", async () => {
    const bytes = makeMp4({ audioEntries: [makeAudioEntry("mp4a", { dataReferenceIndex: 2 })] });
    await assert.rejects(() => verify(bytes), isUnsupported);
  });
});

test("accepts structurally declared AAC-LC mono audio", async () => {
  const bytes = makeMp4({
    audioEntries: [makeAudioEntry("mp4a", {
      frequencyIndex: 4,
      channels: 1,
      sampleRate: 44_100,
    })],
  });
  assert.deepEqual(await verify(bytes), expectedStructural());
});

test("accepts square pixels and rejects anamorphic AVC sample aspect ratios", async (context) => {
  const square = makeMp4({
    videoEntries: [makeVisualEntry("avc1", { extraChildren: [box("pasp", u32(1), u32(1))] })],
  });
  assert.deepEqual(await verify(square), expectedStructural());
  for (const [horizontal, vertical] of [[4, 3], [0, 1]]) {
    await context.test(`${horizontal}:${vertical}`, async () => {
      const bytes = makeMp4({
        videoEntries: [makeVisualEntry("avc1", { extraChildren: [box("pasp", u32(horizontal), u32(vertical))] })],
      });
      await assert.rejects(() => verify(bytes), isUnsupported);
    });
  }
});

test("rejects AAC sample rates outside the authoritative 8-48 kHz matrix", async (context) => {
  for (const fixture of [
    { sampleRate: 64_000, frequencyIndex: 2 },
    { sampleRate: 7_350, frequencyIndex: 12 },
  ]) {
    await context.test(String(fixture.sampleRate), async () => {
      const bytes = makeMp4({ audioEntries: [makeAudioEntry("mp4a", fixture)] });
      await assert.rejects(() => verify(bytes), isUnsupported);
    });
  }
});

test("rejects mp4a entries that do not prove ordinary AAC-LC", async (context) => {
  const cases = [
    { label: "missing-esds", options: { includeEsds: false } },
    { label: "mp3-object-type", options: { objectType: 0x6b } },
    { label: "he-aac", options: { audioObjectType: 5 } },
    { label: "he-aac-v2", options: { audioObjectType: 29 } },
    { label: "channel-mismatch", options: { channels: 2, configChannels: 1 } },
    { label: "frequency-mismatch", options: { sampleRate: 48_000, frequencyIndex: 4 } },
    { label: "960-sample-frames", options: { gasFlags: 4 } },
    { label: "core-coder-dependency", options: { gasFlags: 2 } },
    { label: "extension-syntax", options: { gasFlags: 1 } },
    { label: "upstream-stream-flag", options: { streamFlags: 0x17 } },
    { label: "back-compatible-he-aac-sync-extension", options: { audioConfigSuffix: [0x56, 0xe5] } },
  ];
  for (const fixture of cases) {
    await context.test(fixture.label, async () => {
      const bytes = makeMp4({ audioEntries: [makeAudioEntry("mp4a", fixture.options)] });
      await assert.rejects(() => verify(bytes), isUnsupported);
    });
  }
});

test("jumps over a large mdat to find a tail moov without downloading media payload", async () => {
  const ftyp = makeFtyp();
  const sample = Buffer.from([0, 0, 0, 2, 0x65, 0xb8]);
  const spoof = Buffer.from("not-a-box moov hvc1 av01 vp09 encv mp4a");
  const mdatPayload = Buffer.alloc(5 * MEBIBYTE, 0x55);
  sample.copy(mdatPayload, 0);
  spoof.copy(mdatPayload, 17);
  const mdat = box("mdat", mdatPayload);
  const moov = makeMoov({ chunkOffset: ftyp.length + 8, sampleSize: sample.length });
  const bytes = Buffer.concat([ftyp, mdat, moov]);
  const fetchImpl = rangeFetch(bytes);

  assert.deepEqual(await verify(bytes, { fetchImpl }), expectedStructural());
  assert.ok(fetchImpl.requests.some(({ start }) => start === ftyp.length + mdat.length));
  assert.ok(fetchImpl.requests.every(({ end, start }) => end - start + 1 <= Math.max(moov.length, ftyp.length)));
  assert.ok(fetchImpl.requests.every(({ start, end }) => !(start > ftyp.length + 16 && end < ftyp.length + mdat.length - 1)));
});

test("rejects non-hvc1 HEVC, Dolby Vision, encrypted, and unknown video sample entries", async (context) => {
  for (const type of ["hev1", "dvhe", "dvh1", "av01", "vp09", "encv", "zzzz"]) {
    await context.test(type, async () => {
      const bytes = makeMp4({ videoEntries: [makeVisualEntry(type)] });
      await assert.rejects(() => verify(bytes), isUnsupported);
    });
  }
});

test("rejects unsupported HEVC profiles, depths, and Dolby Vision configuration", async (context) => {
  const cases = [
    { label: "unsupported-profile", options: { profile: 3 } },
    { label: "main-with-10-bit", options: { profile: 1, bitDepthMinus8: 1 } },
    { label: "main10-with-12-bit", options: { profile: 2, bitDepthMinus8: 2 } },
    { label: "dolby-dvcC", options: { profile: 2, bitDepthMinus8: 1, extraChildren: [box("dvcC")] } },
    { label: "dolby-dvvC", options: { profile: 2, bitDepthMinus8: 1, extraChildren: [box("dvvC")] } },
  ];
  for (const fixture of cases) {
    await context.test(fixture.label, async () => {
      const bytes = makeMp4({ videoEntries: [makeVisualEntry("hvc1", fixture.options)] });
      await assert.rejects(() => verify(bytes), isUnsupported);
    });
  }
});

test("rejects non-mp4a and encrypted audio sample entries", async (context) => {
  for (const type of ["enca", "ac-3", "Opus"]) {
    await context.test(type, async () => {
      const bytes = makeMp4({ audioEntries: [makeAudioEntry(type)] });
      await assert.rejects(() => verify(bytes), isUnsupported);
    });
  }
});

test("rejects malformed AVC or HEVC entries without decoder configuration", async (context) => {
  for (const type of ["avc1", "hvc1"]) {
    await context.test(type, async () => {
      const bytes = makeMp4({ videoEntries: [makeVisualEntry(type, { includeConfiguration: false })] });
      await assert.rejects(() => verify(bytes), isUnsupported);
    });
  }
});

test("rejects protection metadata even when an entry claims an allowed codec", async (context) => {
  await context.test("video", async () => {
    const bytes = makeMp4({ videoEntries: [makeVisualEntry("avc1", { extraChildren: [box("sinf")] })] });
    await assert.rejects(() => verify(bytes), isUnsupported);
  });
  await context.test("hevc-video", async () => {
    const bytes = makeMp4({ videoEntries: [makeVisualEntry("hvc1", {
      profile: 2,
      bitDepthMinus8: 1,
      extraChildren: [box("sinf")],
    })] });
    await assert.rejects(() => verify(bytes), isUnsupported);
  });
  await context.test("audio", async () => {
    const bytes = makeMp4({ audioEntries: [makeAudioEntry("mp4a", { extraChildren: [box("sinf")] })] });
    await assert.rejects(() => verify(bytes), isUnsupported);
  });
});

test("does not treat codec or moov strings inside mdat as boxes", async () => {
  const payload = Buffer.from("moov avc1 avc3 mp4a isom hvc1".repeat(32));
  const bytes = Buffer.concat([makeFtyp(), box("mdat", payload)]);
  await assert.rejects(() => verify(bytes), isUnsupported);
});

test("requires a non-empty top-level mdat", async (context) => {
  await context.test("missing", async () => {
    await assert.rejects(() => verify(makeMp4({ omitMdat: true })), isUnsupported);
  });
  await context.test("empty", async () => {
    await assert.rejects(() => verify(makeMp4({ emptyMdat: true })), isUnsupported);
  });
});

test("requires coherent nonzero sample tables mapped wholly inside mdat", async (context) => {
  for (const [label, videoTable] of Object.entries({
    "missing-stsz": { omitStsz: true },
    "missing-stsc": { omitStsc: true },
    "missing-stco": { omitStco: true },
  })) {
    await context.test(label, async () => {
      await assert.rejects(() => verify(makeMp4({ videoTable })), isUnsupported);
    });
  }
  await context.test("zero-sample-size", async () => {
    await assert.rejects(() => verify(makeMp4({
      sample: Buffer.alloc(0),
      mdatPayload: Buffer.from([1]),
    })), isUnsupported);
  });
  await context.test("chunk-offset-outside-mdat", async () => {
    await assert.rejects(() => verify(makeMp4({ chunkOffsetOverride: 1 })), isUnsupported);
  });
  await context.test("stts-count-disagrees-with-stsz", async () => {
    const sample = Buffer.from([0, 0, 0, 2, 0x65, 0xb8]);
    await assert.rejects(() => verify(makeMp4({
      sample,
      mdatPayload: Buffer.concat([sample, sample]),
      videoTable: { tableSampleCount: 2 },
    })), isUnsupported);
  });
  await context.test("mapped-samples-overrun-mdat", async () => {
    await assert.rejects(() => verify(makeMp4({ videoTable: { tableSampleCount: 2 } })), isUnsupported);
  });
});

test("range-checks a complete independent first AVC sample", async (context) => {
  const invalidSamples = [
    { label: "zero-length-nal", sample: Buffer.from([0, 0, 0, 0]) },
    { label: "header-only-idr", sample: Buffer.from([0, 0, 0, 1, 0x65]) },
    { label: "forbidden-zero-bit", sample: Buffer.from([0, 0, 0, 2, 0xe5, 0xb8]) },
    { label: "non-independent-slice", sample: Buffer.from([0, 0, 0, 2, 0x41, 0xb8]) },
    { label: "malformed-slice-header", sample: Buffer.from([0, 0, 0, 2, 0x65, 0x00]) },
  ];
  for (const fixture of invalidSamples) {
    await context.test(fixture.label, async () => {
      await assert.rejects(() => verify(makeMp4({ sample: fixture.sample })), isUnsupported);
    });
  }
});

test("rejects an oversized moov before fetching its body", async () => {
  const ftyp = makeFtyp();
  const moovSize = 4 * MEBIBYTE + 1;
  const bytes = Buffer.concat([ftyp, declaredBox("moov", moovSize), Buffer.alloc(moovSize - 8)]);
  const fetchImpl = rangeFetch(bytes);
  await assert.rejects(() => verify(bytes, { fetchImpl }), isUnsupported);
  assert.ok(fetchImpl.requests.every(({ end, start }) => end - start + 1 <= 16));
});

test("treats a wrong Content-Range as a storage provider failure", async () => {
  const bytes = makeMp4();
  const fetchImpl = rangeFetch(bytes, {
    mutateResponse: ({ bytes: source, start, end }) => responseForRange(source, start, end, {
      contentRange: `bytes ${start + 1}-${end}/${source.length}`,
    }),
  });
  await assert.rejects(
    () => verify(bytes, { fetchImpl }),
    (error) => error instanceof ApiError && error.status === 503 && error.code === "MEDIA_STORAGE_UNAVAILABLE",
  );
});

test("signs and sends If-Match on every request and maps generation changes to conflict", async () => {
  const bytes = makeMp4();
  const ifMatch = '"generation-123"';
  let calls = 0;
  const fetchImpl = rangeFetch(bytes, {
    expectedIfMatch: ifMatch,
    mutateResponse: ({ normal }) => {
      calls += 1;
      return calls === 2 ? new Response(null, { status: 412 }) : normal;
    },
  });
  await assert.rejects(
    () => verify(bytes, { fetchImpl, ifMatch }),
    (error) => error instanceof ApiError && error.status === 409 && error.code === "CONFLICT",
  );
  assert.equal(calls, 2);
});

test("rejects missing, zero, unknown, and overflowing movie durations", async (context) => {
  const invalidMovies = [
    { label: "zero", movie: { duration: 0 } },
    { label: "unknown-v0", movie: { duration: 0xffffffff } },
    { label: "zero-timescale", movie: { timescale: 0, duration: 1 } },
    { label: "unknown-v1", movie: { version: 1, duration: 0xffffffffffffffffn } },
    { label: "overflow-v1", movie: { version: 1, timescale: 1, duration: 0x20000000000000n } },
  ];
  for (const fixture of invalidMovies) {
    await context.test(fixture.label, async () => {
      const bytes = makeMp4({ movie: fixture.movie });
      await assert.rejects(() => verify(bytes), isUnsupported);
    });
  }

  await context.test("missing-mvhd", async () => {
    const bytes = Buffer.concat([makeFtyp(), box("moov", makeTrack("vide", [makeVisualEntry()]))]);
    await assert.rejects(() => verify(bytes), isUnsupported);
  });
});

test("derives duration from mvhd, each mdhd, and each stts timeline", async (context) => {
  await context.test("returns-longest-declared-track-duration", async () => {
    const bytes = makeMp4({
      movie: { duration: 5_000 },
      videoTiming: { mdhdDuration: 5_500, sampleDelta: 5_400 },
    });
    assert.deepEqual(await verify(bytes), expectedStructural({ durationMs: 5_500 }));
  });
  await context.test("rejects-overlong-video-mdhd", async () => {
    const bytes = makeMp4({ videoTiming: { mdhdDuration: 60_001, sampleDelta: 5_001 } });
    await assert.rejects(() => verify(bytes), isUnsupported);
  });
  await context.test("rejects-overlong-video-sample-timeline", async () => {
    const bytes = makeMp4({ videoTiming: { mdhdDuration: 5_001, sampleCount: 61, sampleDelta: 1_000 } });
    await assert.rejects(() => verify(bytes), isUnsupported);
  });
  await context.test("rejects-overlong-audio-sample-timeline", async () => {
    const bytes = makeMp4({
      audioEntries: [makeAudioEntry()],
      audioTiming: { mdhdDuration: 5_001, sampleCount: 61, sampleDelta: 1_000 },
    });
    await assert.rejects(() => verify(bytes), isUnsupported);
  });
  await context.test("rejects-missing-mdhd", async () => {
    const bytes = makeMp4({ videoTiming: { omitMdhd: true } });
    await assert.rejects(() => verify(bytes), isUnsupported);
  });
  await context.test("rejects-missing-stts", async () => {
    const bytes = makeMp4({ videoTiming: { omitStts: true } });
    await assert.rejects(() => verify(bytes), isUnsupported);
  });
});

test("rejects clips whose frame rate or decoded pixel work exceeds the verifier envelope", async (context) => {
  const sample = Buffer.from([0, 0, 0, 2, 0x65, 0xb8]);
  await context.test("high-sample-rate", async () => {
    const sampleCount = 601;
    const bytes = makeMp4({
      movie: { duration: 5_001 },
      videoTiming: { mdhdDuration: 5_001, sampleCount, sampleDelta: 8 },
      mdatPayload: Buffer.concat(Array.from({ length: sampleCount }, () => sample)),
    });
    await assert.rejects(() => verify(bytes), isUnsupported);
  });
  await context.test("4k-pixel-work", async () => {
    const sampleCount = 1_800;
    const bytes = makeMp4({
      videoEntries: [makeVisualEntry("avc1", { width: 3_840, height: 2_160, level: 51 })],
      movie: { duration: 60_000 },
      videoTiming: { mdhdDuration: 60_000, sampleCount, sampleDelta: 33 },
      mdatPayload: Buffer.concat(Array.from({ length: sampleCount }, () => sample)),
    });
    await assert.rejects(() => verify(bytes), isUnsupported);
  });
  await context.test("cropped-high-coded-area", async () => {
    const sampleCount = 1_800;
    const bytes = makeMp4({
      videoEntries: [makeVisualEntry("avc1", {
        width: 16,
        height: 16,
        spsWidth: 16,
        spsHeight: 16,
        spsCodedWidth: 4_096,
        spsCodedHeight: 2_160,
        level: 51,
      })],
      movie: { duration: 60_000 },
      videoTiming: { mdhdDuration: 60_000, sampleCount, sampleDelta: 33 },
      mdatPayload: Buffer.concat(Array.from({ length: sampleCount }, () => sample)),
    });
    await assert.rejects(() => verify(bytes), isUnsupported);
  });
  await context.test("exact-1080p60-boundary", async () => {
    const sampleCount = 3_600;
    const bytes = makeMp4({
      movie: { duration: 60_000 },
      videoTiming: { timescale: 60_000, mdhdDuration: 3_600_000, sampleCount, sampleDelta: 1_000 },
      mdatPayload: Buffer.concat(Array.from({ length: sampleCount }, () => sample)),
    });
    assert.deepEqual(await verify(bytes), expectedStructural({ durationMs: 60_000, sampleCount }));
  });
  await context.test("one-frame-over-1080p-work-boundary", async () => {
    const sampleCount = 3_601;
    const bytes = makeMp4({
      movie: { duration: 60_000 },
      videoTiming: { timescale: 3_601, mdhdDuration: 216_060, sampleCount, sampleDelta: 60 },
      mdatPayload: Buffer.concat(Array.from({ length: sampleCount }, () => sample)),
    });
    await assert.rejects(() => verify(bytes), isUnsupported);
  });
});

test("rejects a truncated or overlong range body as provider failure", async (context) => {
  const bytes = makeMp4();
  for (const delta of [-1, 1]) {
    await context.test(delta < 0 ? "truncated" : "overlong", async () => {
      const fetchImpl = rangeFetch(bytes, {
        mutateResponse: ({ bytes: source, start, end }) => {
          const requestedLength = end - start + 1;
          const body = delta < 0
            ? source.subarray(start, Math.max(start, end))
            : Buffer.concat([source.subarray(start, end + 1), Buffer.from([0])]);
          return new Response(body, {
            status: 206,
            headers: {
              "Content-Length": String(requestedLength),
              "Content-Range": `bytes ${start}-${end}/${source.length}`,
            },
          });
        },
      });
      await assert.rejects(
        () => verify(bytes, { fetchImpl }),
        (error) => error instanceof ApiError && error.status === 503 && error.code === "MEDIA_STORAGE_UNAVAILABLE",
      );
    });
  }
});
