import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PUBLIC_MEDIA_CACHE_CONTROL } from "./mediaDeliveryPolicy.js";
import {
  MEDIA_VIDEO_MAX_DURATION_MS,
  MEDIA_VIDEO_MAX_SAMPLES,
  MEDIA_VIDEO_SOURCE_MAX_BYTES,
} from "../src/domain/mediaUploadPolicy.mjs";

import {
  createVideoVerifierService,
  getVideoVerifierServiceConfig,
  runVideoVerifierJob,
  validateVideoVerifierJob,
  videoDeliveryStrategy,
  videoTranscodeBitrateBudget,
} from "./videoVerifierService.js";
import {
  signVideoVerifierRequest,
  verifyVideoVerifierResponse,
  VIDEO_VERIFIER_MAX_DISCARDED_QUICKTIME_TRACKS,
  VIDEO_VERIFIER_PROTOCOL_VERSION,
  VIDEO_VERIFIER_SOURCE_ADMISSION_REVISION,
  VIDEO_VERIFIER_UNIVERSAL_ADMISSION,
} from "./videoVerifierProtocol.js";

const SECRET = "video-verifier-service-secret-at-least-thirty-two-bytes";
const ENV = Object.freeze({
  PIT_VIDEO_VERIFIER_SECRET: SECRET,
  PIT_VIDEO_SOURCE_ORIGIN: "https://objects.example.com/s3",
  PIT_VIDEO_SOURCE_BUCKET: "pit-media",
  PIT_VIDEO_OUTPUT_ORIGIN: "https://objects.example.com/s3",
  PIT_VIDEO_OUTPUT_BUCKET: "pit-media-public",
  PORT: "10001",
});
const ETAG = '"source-generation"';
const SOURCE = Buffer.from("bounded-mp4-source-fixture");
const POSTER = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0xff, 0xd9]);

function capabilityUrl(objectKey = "source.mp4") {
  const credential = encodeURIComponent("access/20260823/auto/s3/aws4_request");
  const signedHeaders = encodeURIComponent("host;if-match");
  return `https://objects.example.com/s3/pit-media/users/u_video/post/${objectKey}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=${credential}&X-Amz-Date=20260823T120000Z&X-Amz-Expires=120&X-Amz-SignedHeaders=${signedHeaders}&X-Amz-Signature=${"a".repeat(64)}`;
}

function outputCapabilityUrl() {
  const credential = encodeURIComponent("access/20260823/auto/s3/aws4_request");
  const signedHeaders = encodeURIComponent("cache-control;content-type;host;if-none-match");
  return `https://objects.example.com/s3/pit-media-public/users/u_video/post/delivery.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=${credential}&X-Amz-Date=20260823T120000Z&X-Amz-Expires=120&X-Amz-SignedHeaders=${signedHeaders}&X-Amz-Signature=${"b".repeat(64)}`;
}

function validJob(overrides = {}) {
  return {
    protocol: VIDEO_VERIFIER_PROTOCOL_VERSION,
    object: {
      key: "users/u_video/post/source.mp4",
      byteSize: SOURCE.byteLength,
      contentType: "video/mp4",
      etag: ETAG,
      downloadUrl: capabilityUrl(),
      downloadHeaders: { "If-Match": ETAG },
    },
    structural: {
      width: 1_920,
      height: 1_080,
      codedWidth: 1_920,
      codedHeight: 1_088,
      sampleCount: 300,
      durationMs: 10_000,
    },
    poster: {
      timeMs: 2_000,
      contentType: "image/jpeg",
      maxBytes: 1_500_000,
      maxEdge: 1_280,
    },
    output: {
      key: "users/u_video/post/delivery.mp4",
      contentType: "video/mp4",
      uploadUrl: outputCapabilityUrl(),
      uploadHeaders: {
        "Cache-Control": PUBLIC_MEDIA_CACHE_CONTROL,
        "Content-Type": "video/mp4",
        "If-None-Match": "*",
      },
    },
    ...overrides,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

async function startService(overrides = {}) {
  const service = createVideoVerifierService({
    env: ENV,
    prerequisiteCheck: async () => ({ ffmpegVersion: "ffmpeg test" }),
    ...overrides,
  });
  const address = await service.listen(0, "127.0.0.1");
  return { service, origin: `http://127.0.0.1:${address.port}` };
}

function signedRequest(path, payload, nonce) {
  return signVideoVerifierRequest({ secret: SECRET, path, payload, ...(nonce ? { nonce } : {}) });
}

async function postSigned(origin, path, signed, { signal } = {}) {
  return fetch(`${origin}${path}`, {
    method: "POST",
    headers: signed.headers,
    body: signed.body,
    signal,
  });
}

async function authenticatedResponse(response, path, nonce) {
  const body = await response.text();
  return verifyVideoVerifierResponse({
    secret: SECRET,
    path,
    requestNonce: nonce,
    body,
    headers: response.headers,
  });
}

test("service config pins the allowed Render port and excludes forbidden defaults", () => {
  assert.deepEqual(getVideoVerifierServiceConfig(ENV).port, 10_001);
  assert.equal(getVideoVerifierServiceConfig({ ...ENV, PORT: "10000" }).configured, false);
  assert.equal(getVideoVerifierServiceConfig({ ...ENV, PIT_VIDEO_SOURCE_ORIGIN: "http://objects.example.com" }).configured, false);
  assert.equal(getVideoVerifierServiceConfig({ ...ENV, PIT_VIDEO_OUTPUT_BUCKET: ENV.PIT_VIDEO_SOURCE_BUCKET }).configured, false);
});

test("worker authenticates health, caps request bytes before JSON parse, and rejects nonce replay", async (context) => {
  const { service, origin } = await startService();
  try {
    const signed = signedRequest("/v2/health", { protocol: VIDEO_VERIFIER_PROTOCOL_VERSION }, "abcdefghijklmnopqrstuv");
    const first = await postSigned(origin, "/v2/health", signed);
    assert.equal(first.status, 200);
    const health = await authenticatedResponse(first, "/v2/health", signed.nonce);
    assert.equal(health.decoder.ffmpeg, true);
    assert.equal(health.poster.decoded, true);
    assert.equal(health.sourceAdmissionRevision, VIDEO_VERIFIER_SOURCE_ADMISSION_REVISION);
    assert.deepEqual(health.sourceTypes, ["video/mp4", "video/quicktime"]);
    assert.deepEqual(health.sourceCodecs, {
      "video/mp4": ["h264", "hevc"],
      "video/quicktime": ["h264", "hevc"],
    });

    const replay = await postSigned(origin, "/v2/health", signed);
    assert.equal(replay.status, 409);
    assert.equal((await authenticatedResponse(replay, "/v2/health", signed.nonce)).code, "replay");

    await context.test("body-cap", async () => {
      const response = await fetch(`${origin}/v2/health`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": String(17 * 1024) },
        body: "x".repeat(17 * 1024),
      });
      assert.equal(response.status, 413);
      assert.deepEqual(await response.json(), { ok: false });
    });
  } finally {
    await service.close();
  }
});

test("global decoder concurrency rejects busy without queueing and disconnect cancels its job", async () => {
  const firstGate = deferred();
  const disconnectGate = deferred();
  let calls = 0;
  let cancelled = false;
  const verifyJob = async (payload, { signal }) => {
    calls += 1;
    const gate = calls === 1 ? firstGate : disconnectGate;
    await Promise.race([
      gate.promise,
      new Promise((resolve, reject) => signal.addEventListener("abort", () => {
        cancelled = true;
        reject(signal.reason);
      }, { once: true })),
    ]);
    return { ok: true, object: payload.object };
  };
  const { service, origin } = await startService({ verifyJob });
  try {
    const firstSigned = signedRequest("/v2/verify", validJob());
    const first = postSigned(origin, "/v2/verify", firstSigned);
    while (!service.status().active) await new Promise((resolve) => setImmediate(resolve));
    const secondSigned = signedRequest("/v2/verify", validJob());
    const second = await postSigned(origin, "/v2/verify", secondSigned);
    assert.equal(second.status, 429);
    assert.equal((await authenticatedResponse(second, "/v2/verify", secondSigned.nonce)).code, "busy");
    assert.equal(calls, 1);
    firstGate.resolve();
    assert.equal((await first).status, 200);

    const abort = new AbortController();
    const disconnectSigned = signedRequest("/v2/verify", validJob());
    const disconnected = postSigned(origin, "/v2/verify", disconnectSigned, { signal: abort.signal });
    while (!service.status().active) await new Promise((resolve) => setImmediate(resolve));
    abort.abort();
    await assert.rejects(() => disconnected, { name: "AbortError" });
    for (let index = 0; index < 100 && !cancelled; index += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(cancelled, true);
  } finally {
    await service.close();
  }
});

test("job validation binds exact origin/key/generation and enforces the coded-work envelope", () => {
  const config = getVideoVerifierServiceConfig(ENV);
  assert.equal(validateVideoVerifierJob(validJob(), config).structural.sampleCount, 300);
  assert.equal(validateVideoVerifierJob(validJob({
    structural: { ...validJob().structural, sourceAdmissionRevision: 2 },
  }), config).structural.sourceAdmissionRevision, 2);
  assert.throws(() => validateVideoVerifierJob(validJob({
    structural: { ...validJob().structural, sourceAdmissionRevision: 3 },
  }), config), { code: "incompatible_protocol" });
  assert.equal(validateVideoVerifierJob(validJob({
    structural: { ...validJob().structural, sourceCodec: "hevc" },
  }), config).structural.sourceCodec, "hevc");
  assert.throws(() => validateVideoVerifierJob(validJob({
    object: { ...validJob().object, downloadUrl: capabilityUrl().replace("objects.example.com", "evil.example.com") },
  }), config), { code: "invalid_request" });
  assert.throws(() => validateVideoVerifierJob(validJob({
    structural: { ...validJob().structural, sampleCount: MEDIA_VIDEO_MAX_SAMPLES + 1, durationMs: MEDIA_VIDEO_MAX_DURATION_MS },
  }), config), { code: "invalid_request" });
  assert.throws(() => validateVideoVerifierJob(validJob({
    object: { ...validJob().object, contentType: "video/quicktime" },
  }), config), { code: "invalid_request" }, "MIME and source extension stay identity-bound");
  assert.throws(() => validateVideoVerifierJob(validJob({
    structural: { ...validJob().structural, sourceContainer: "quicktime", sourceCodec: "hevc" },
  }), config), { code: "invalid_request" }, "an MP4 source cannot claim QuickTime structure");
  assert.throws(() => validateVideoVerifierJob(validJob({
    structural: { ...validJob().structural, sourceCodec: "h264" },
  }), config), { code: "invalid_request" }, "legacy MP4 H.264 keeps its exact structural shape");
  assert.throws(() => validateVideoVerifierJob(validJob({
    output: {
      ...validJob().output,
      uploadHeaders: { ...validJob().output.uploadHeaders, "Cache-Control": "public, max-age=60" },
    },
  }), config), { code: "invalid_request" }, "the worker cannot alter the exact signed public cache policy");
  const unsignedCachePolicy = new URL(outputCapabilityUrl());
  unsignedCachePolicy.searchParams.set("X-Amz-SignedHeaders", "content-type;host;if-none-match");
  assert.throws(() => validateVideoVerifierJob(validJob({
    output: { ...validJob().output, uploadUrl: unsignedCachePolicy.toString() },
  }), config), { code: "invalid_request" }, "the exact cache header must be covered by SigV4");
});

test("signed source rejection identifies the exact worker admission policy", async () => {
  const { service, origin } = await startService({ verifyJob: async () => {
    throw Object.assign(new Error("private decoder detail"), { status: 422, code: "unsupported_media" });
  } });
  try {
    const signed = signedRequest("/v2/verify", validJob({
      structural: { ...validJob().structural, sourceAdmissionRevision: 2 },
    }));
    const response = await postSigned(origin, "/v2/verify", signed);
    assert.equal(response.status, 422);
    assert.deepEqual(await authenticatedResponse(response, "/v2/verify", signed.nonce), {
      ok: false, code: "unsupported_media", sourceAdmissionRevision: 2,
    });
  } finally {
    await service.close();
  }
});

test("an exact source generation loss is a conflict before decoder work", async () => {
  const root = await mkdtemp(join(tmpdir(), "pit-verifier-generation-"));
  let commands = 0;
  try {
    await assert.rejects(() => runVideoVerifierJob(validJob(), {
      config: getVideoVerifierServiceConfig(ENV),
      fetchImpl: async () => new Response(null, { status: 412 }),
      runProcess: async () => { commands += 1; return { stdout: "", stderr: "" }; },
      signal: AbortSignal.timeout(5_000),
      temporaryRoot: root,
    }), (error) => error.status === 409 && error.code === "object_changed");
    assert.equal(commands, 0);
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function videoProbe({
  rotation = 90,
  codec = "h264",
  codecTag = codec === "hevc" ? "hvc1" : "avc1",
  profile = codec === "hevc" ? "Main" : "High",
  level = codec === "hevc" ? 120 : 40,
  pixelFormat = codec === "hevc" ? "yuv420p10le" : "yuv420p",
  majorBrand = "isom",
  compatibleBrands = "isomiso2avc1mp41",
  sampleAspectRatio = "1:1",
  omitSampleAspectRatio = false,
  fieldOrder = "progressive",
  width = 1_920,
  height = 1_080,
  codedWidth = 1_920,
  codedHeight = 1_088,
  metadataStreams = [],
  frameRate = "30/1",
  realFrameRate = frameRate,
  frameCount,
  duration = "10.000",
} = {}) {
  return JSON.stringify({
    streams: [{
      codec_type: "video",
      codec_name: codec,
      codec_tag_string: codecTag,
      profile,
      level,
      pix_fmt: pixelFormat,
      width,
      height,
      coded_width: codedWidth,
      coded_height: codedHeight,
      field_order: fieldOrder,
      ...(omitSampleAspectRatio ? {} : { sample_aspect_ratio: sampleAspectRatio }),
      avg_frame_rate: frameRate,
      r_frame_rate: realFrameRate,
      ...(frameCount === undefined ? {} : { nb_frames: frameCount }),
      disposition: { attached_pic: 0 },
      tags: rotation ? { rotate: String(rotation) } : {},
      side_data_list: rotation ? [{ rotation }] : [],
    }, ...metadataStreams],
    format: {
      format_name: "mov,mp4,m4a,3gp,3g2,mj2",
      duration,
      tags: { major_brand: majorBrand, compatible_brands: compatibleBrands },
    },
  });
}

function fakeRunner({
  probe = videoProbe(),
  deliveryProbe = videoProbe({
    rotation: 0, width: 1_920, height: 1_080, codedWidth: 1_920, codedHeight: 1_088,
  }),
  posterProbe = JSON.stringify({
    streams: [{ codec_type: "video", codec_name: "mjpeg", width: 1_280, height: 720 }],
  }),
} = {}) {
  const calls = [];
  const runProcess = async (executable, args, options) => {
    calls.push({ executable, args: [...args], options });
    if (executable === "ffprobe" && args.some((value) => /source\.(?:mp4|mov)$/.test(String(value)))) {
      return { stdout: probe, stderr: "" };
    }
    if (executable === "ffprobe" && args.some((value) => String(value).endsWith("delivery.mp4"))) {
      return { stdout: deliveryProbe, stderr: "" };
    }
    if (executable === "ffprobe") {
      return { stdout: posterProbe, stderr: "" };
    }
    const output = args.at(-1);
    if (typeof output === "string" && output.endsWith("poster.jpg")) await writeFile(output, POSTER);
    if (typeof output === "string" && output.endsWith("delivery.mp4")) await writeFile(output, SOURCE);
    return { stdout: "", stderr: "" };
  };
  runProcess.calls = calls;
  return runProcess;
}

test("delivery strategy remuxes only bounded unrotated H.264 and preserves every transcode boundary", () => {
  assert.equal(videoDeliveryStrategy({ codec: "h264", audioCodec: "aac", rotation: 0, width: 1_920, height: 1_080 }), "remux");
  assert.equal(videoDeliveryStrategy({ codec: "h264", audioCodec: "none", rotation: 0, width: 1_280, height: 720 }), "remux");
  for (const video of [
    { codec: "hevc", audioCodec: "aac", rotation: 0, width: 1_920, height: 1_080 },
    { codec: "h264", audioCodec: "aac", rotation: 90, width: 1_920, height: 1_080 },
    { codec: "h264", audioCodec: "aac", rotation: 0, width: 1_921, height: 1_080 },
    { codec: "h264", audioCodec: "aac", rotation: 0, width: 1_920, height: 1_081 },
    { codec: "h264", audioCodec: "mp3", rotation: 0, width: 1_920, height: 1_080 },
    { codec: "h264", audioCodec: "aac", rotation: 0, width: 1_920, height: 1_080, frameRate: 240 },
  ]) assert.equal(videoDeliveryStrategy(video), "transcode");
});

test("transcode rates reserve complete audio, VBV burst, and container headroom within the output cap", () => {
  const short = videoTranscodeBitrateBudget(10_000);
  assert.deepEqual(short, { maxRate: 11_000_000, bufferSize: 22_000_000, audioRate: 160_000 });
  const longest = videoTranscodeBitrateBudget(MEDIA_VIDEO_MAX_DURATION_MS);
  assert.deepEqual(longest, { maxRate: 6_445_000, bufferSize: 12_890_000, audioRate: 160_000 });
  assert.ok((short.maxRate + short.audioRate) * 600 / 8 > MEDIA_VIDEO_SOURCE_MAX_BYTES,
    "the former constant ceiling could exceed the accepted byte cap on a ten-minute noisy clip");
  let previousRate = Number.POSITIVE_INFINITY;
  for (const durationMs of Array.from({ length: 601 }, (_, index) => Math.max(1, index * 1_000))) {
    const budget = videoTranscodeBitrateBudget(durationMs);
    const worstCaseStreamBytes = ((budget.maxRate + budget.audioRate) * durationMs / 1_000 + budget.bufferSize) / 8;
    assert.ok(worstCaseStreamBytes <= Math.floor(MEDIA_VIDEO_SOURCE_MAX_BYTES * 0.95) - 1_048_576);
    assert.ok(budget.maxRate <= previousRate, "longer clips must not gain a higher byte rate");
    assert.ok(budget.maxRate > 0 && budget.maxRate <= 11_000_000);
    previousRate = budget.maxRate;
  }
});

test("transcode output budgeting rejects invalid or over-contract durations", () => {
  for (const durationMs of [undefined, null, "600000", 0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY,
    MEDIA_VIDEO_MAX_DURATION_MS + 1, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => videoTranscodeBitrateBudget(durationMs), { code: "invalid_request" });
  }
});

test("long HEVC and maximum-rate source jobs apply byte-safe transcode arguments without truncating", async (context) => {
  for (const fixture of [
    { label: "ten-minute HEVC concert", duration: "600.000", frameRate: 60, sampleCount: 36_000, maxRate: 6_445_000 },
    { label: "maximum 240fps source", duration: "150.000", frameRate: 240, sampleCount: 36_000, maxRate: 11_000_000 },
  ]) {
    await context.test(fixture.label, async () => {
      const root = await mkdtemp(join(tmpdir(), "pit-verifier-bitrate-"));
      const audio = [{ codec_type: "audio", codec_name: "aac", codec_tag_string: "mp4a", profile: "LC",
        channels: 2, channel_layout: "stereo", sample_rate: "48000" }];
      const runProcess = fakeRunner({
        probe: videoProbe({ codec: "hevc", profile: "Main 10", rotation: 0, duration: fixture.duration,
          frameRate: `${fixture.frameRate}/1`, frameCount: String(fixture.sampleCount), metadataStreams: audio }),
        deliveryProbe: videoProbe({ rotation: 0, duration: fixture.duration, frameRate: "60/1", metadataStreams: audio }),
      });
      let uploads = 0;
      try {
        const result = await runVideoVerifierJob(validJob({ structural: { ...validJob().structural,
          durationMs: Number(fixture.duration) * 1_000, sampleCount: fixture.sampleCount,
          sourceAdmissionRevision: VIDEO_VERIFIER_SOURCE_ADMISSION_REVISION,
        } }), {
          config: getVideoVerifierServiceConfig(ENV),
          fetchImpl: async (url, request) => {
            if (request.method === "PUT") { uploads += 1; return new Response(null, { status: 200 }); }
            return new Response(SOURCE, { status: 200,
              headers: { "content-type": "video/mp4", "content-length": String(SOURCE.byteLength), etag: ETAG } });
          },
          runProcess,
          signal: AbortSignal.timeout(5_000),
          temporaryRoot: root,
        });
        const creation = runProcess.calls.find((call) => call.executable === "ffmpeg"
          && call.args.at(-1)?.endsWith("delivery.mp4"));
        const option = (key) => creation.args[creation.args.indexOf(key) + 1];
        assert.equal(Number(option("-maxrate")), fixture.maxRate);
        assert.equal(Number(option("-bufsize")), fixture.maxRate * 2);
        assert.equal(Number(option("-b:a")), 160_000);
        const worstCaseStreamBytes = ((Number(option("-maxrate")) + Number(option("-b:a"))) * Number(fixture.duration)
          + Number(option("-bufsize"))) / 8;
        assert.ok(worstCaseStreamBytes < MEDIA_VIDEO_SOURCE_MAX_BYTES);
        assert.equal(creation.args.includes("-fs") || creation.args.includes("-t"), false,
          "do not silently truncate a member's clip to meet the output cap");
        assert.equal(option("-crf"), "21");
        assert.equal(option("-pix_fmt"), "yuv420p");
        assert.equal(option("-vf").startsWith("fps=60,"), fixture.frameRate > 60);
        assert.equal(result.delivery.durationMs, Number(fixture.duration) * 1_000);
        assert.equal(result.delivery.width, 1_920);
        assert.equal(result.delivery.height, 1_080);
        assert.equal(runProcess.calls.some((call) => call.executable === "ffmpeg" && call.args.includes("null")
          && call.args.some((arg) => String(arg).endsWith("delivery.mp4"))), true);
        assert.equal(uploads, 1);
        assert.deepEqual(await readdir(root), []);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test("authoritative bounded H.264 job strips metadata by remux, fully decodes output, and cleans temp state", async () => {
  const root = await mkdtemp(join(tmpdir(), "pit-verifier-test-"));
  const runProcess = fakeRunner({
    probe: videoProbe({ rotation: 0, omitSampleAspectRatio: true }),
    deliveryProbe: videoProbe({ rotation: 0, omitSampleAspectRatio: true }),
  });
  const fetchImpl = async (url, request) => {
    assert.equal(new URL(url).origin, "https://objects.example.com");
    assert.equal(request.redirect, "error");
    if (request.method === "PUT") {
      assert.equal(new URL(url).pathname.endsWith("/pit-media-public/users/u_video/post/delivery.mp4"), true);
      assert.equal(new Headers(request.headers).get("cache-control"), PUBLIC_MEDIA_CACHE_CONTROL);
      return new Response(null, { status: 200 });
    }
    assert.deepEqual(request.headers, { "If-Match": ETAG });
    return new Response(SOURCE, {
      status: 200,
      headers: {
        "content-type": "video/mp4",
        "content-length": String(SOURCE.byteLength),
        etag: ETAG,
      },
    });
  };
  try {
    const result = await runVideoVerifierJob(validJob(), {
      config: getVideoVerifierServiceConfig(ENV),
      fetchImpl,
      runProcess,
      signal: AbortSignal.timeout(5_000),
      temporaryRoot: root,
    });
    assert.equal(result.video.rotation, 0);
    assert.deepEqual({
      key: result.delivery.key,
      contentType: result.delivery.contentType,
      width: result.delivery.width,
      height: result.delivery.height,
      rotation: result.delivery.rotation,
      uploadStatus: result.delivery.uploadStatus,
    }, {
      key: "users/u_video/post/delivery.mp4",
      contentType: "video/mp4",
      width: 1_920,
      height: 1_080,
      rotation: 0,
      uploadStatus: "created",
    });
    assert.match(result.delivery.sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual({ width: result.poster.width, height: result.poster.height }, { width: 1_280, height: 720 });
    const ffmpegCalls = runProcess.calls.filter((call) => call.executable === "ffmpeg");
    assert.equal(ffmpegCalls.some((call) => call.args.includes("-f") && call.args.includes("mov")
      && call.args.includes("-protocol_whitelist")), true);
    assert.equal(ffmpegCalls.some((call) => call.args.includes("-map") && call.args.includes("0:v:0")
      && call.args.includes("0:a:0?")), true);
    const deliveryCreation = ffmpegCalls.find((call) => call.args.at(-1)?.endsWith("delivery.mp4"));
    assert.ok(deliveryCreation);
    assert.equal(deliveryCreation.args.includes("copy"), true);
    assert.equal(deliveryCreation.args.includes("libx264"), false);
    assert.equal(deliveryCreation.args.includes("-map_metadata") && deliveryCreation.args.includes("-map_chapters"), true);
    assert.equal(ffmpegCalls.some((call) => call.args.includes("-i")
      && call.args.some((value) => String(value).endsWith("delivery.mp4"))
      && call.args.includes("null")), true, "the remuxed delivery still receives a complete decode pass");
    assert.equal(ffmpegCalls.some((call) => call.args.includes("-flags:v")
      && call.args.includes("+bitexact")
      && call.args.some((value) => String(value).endsWith("poster.jpg"))), true,
    "worker covers must omit FFmpeg's Lavc comment metadata");
    const sourceConsumers = runProcess.calls.filter((call) => call.args.some((value) => String(value).endsWith("source.mp4")));
    assert.equal(sourceConsumers.length, 2, "one metadata probe and one sanitized remux consume the source");
    assert.equal(sourceConsumers.every((call) => call.args.includes("-protocol_whitelist")
      && call.args.includes("file,pipe") && call.args.includes("-f") && call.args.includes("mov")), true);
    assert.equal(sourceConsumers.some((call) => JSON.stringify(call.args).includes("https://")
      || JSON.stringify(call.args).includes(SECRET)), false);
    assert.deepEqual(await readdir(root), [], "all per-job temp directories are removed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bounded 120/240 FPS sources normalize to 60 FPS and portrait 4K keeps its signed envelope", async (context) => {
  for (const fixture of [
    { label: "120fps", frameRate: 120, width: 1_920, height: 1_080, codedWidth: 1_920, codedHeight: 1_088 },
    { label: "240fps", frameRate: 240, width: 1_920, height: 1_080, codedWidth: 1_920, codedHeight: 1_088 },
    { label: "portrait-4k", frameRate: 30, width: 2_160, height: 3_840, codedWidth: 2_160, codedHeight: 3_840 },
  ]) {
    await context.test(fixture.label, async () => {
      const root = await mkdtemp(join(tmpdir(), "pit-verifier-source-compatibility-"));
      const { width, height, codedWidth, codedHeight } = fixture;
      const runProcess = fakeRunner({
        probe: videoProbe({ ...fixture, rotation: 0, level: 52, frameRate: `${fixture.frameRate}/1` }),
        deliveryProbe: videoProbe({ rotation: 0, frameRate: "60/1" }),
      });
      try {
        const result = await runVideoVerifierJob(validJob({
          structural: { ...validJob().structural, width, height, codedWidth, codedHeight, sampleCount: fixture.frameRate * 10 },
        }), {
          config: getVideoVerifierServiceConfig(ENV),
          fetchImpl: async (url, request) => request.method === "PUT"
            ? new Response(null, { status: 200 })
            : new Response(SOURCE, {
              status: 200,
              headers: { "content-type": "video/mp4", "content-length": String(SOURCE.byteLength), etag: ETAG },
            }),
          runProcess,
          signal: AbortSignal.timeout(5_000),
          temporaryRoot: root,
        });
        assert.equal(result.video.width, width);
        assert.equal(result.video.height, height);
        const creation = runProcess.calls.find((call) => call.executable === "ffmpeg" && call.args.at(-1)?.endsWith("delivery.mp4"));
        assert.equal(creation.args.includes("libx264"), true);
        const filter = creation.args[creation.args.indexOf("-vf") + 1];
        assert.equal(filter.startsWith("fps=60,"), fixture.frameRate > 60);
        assert.equal(runProcess.calls.some((call) => call.executable === "ffmpeg"
          && call.args.includes("null") && call.args.some((arg) => String(arg).endsWith("delivery.mp4"))), true);
        assert.deepEqual(await readdir(root), []);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test("source FPS, aggregate work, and delivery FPS guards remain independent", async (context) => {
  const config = getVideoVerifierServiceConfig(ENV);
  assert.throws(() => validateVideoVerifierJob(validJob({
    structural: { ...validJob().structural, width: 4_096, height: 4_096, codedWidth: 4_096, codedHeight: 4_096 },
  }), config), { code: "invalid_request" }, "rotating the allowed axes must not admit oversized square frames");
  assert.throws(() => validateVideoVerifierJob(validJob({
    structural: { ...validJob().structural, sampleCount: 2_500 },
  }), config), { code: "invalid_request" });
  assert.throws(() => validateVideoVerifierJob(validJob({
    structural: { ...validJob().structural, width: 2_160, height: 3_840, codedWidth: 2_160, codedHeight: 3_840,
      sampleCount: 10_000, durationMs: MEDIA_VIDEO_MAX_DURATION_MS },
  }), config), { code: "invalid_request" });
  for (const fixture of [
    { label: "source-over-fps", sourceFps: 300, deliveryFps: 60 },
    { label: "delivery-over-fps", sourceFps: 240, deliveryFps: 120 },
  ]) {
    await context.test(fixture.label, async () => {
      const root = await mkdtemp(join(tmpdir(), "pit-verifier-fps-guard-"));
      try {
        await assert.rejects(() => runVideoVerifierJob(validJob({
          structural: { ...validJob().structural, sampleCount: 2_400 },
        }), {
          config,
          fetchImpl: async () => new Response(SOURCE, {
            status: 200,
            headers: { "content-type": "video/mp4", "content-length": String(SOURCE.byteLength), etag: ETAG },
          }),
          runProcess: fakeRunner({
            probe: videoProbe({ rotation: 0, level: 52, frameRate: `${fixture.sourceFps}/1` }),
            deliveryProbe: videoProbe({ rotation: 0, frameRate: `${fixture.deliveryFps}/1` }),
          }),
          signal: AbortSignal.timeout(5_000),
          temporaryRoot: root,
        }), { code: "unsupported_media" });
        assert.deepEqual(await readdir(root), []);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test("exact source frame-count agreement prevents VFR and longer-audio work overestimates", async (context) => {
  for (const fixture of [
    { label: "VFR common timing base", duration: "600.000", sampleCount: 18_000, frameRate: "30/1", realFrameRate: "120/1" },
    { label: "five-second video with longer audio", duration: "400.000", sampleCount: 600, frameRate: "120/1", realFrameRate: "120/1",
      metadataStreams: [{ codec_type: "audio", codec_name: "aac", codec_tag_string: "mp4a", profile: "LC", channels: 2,
        channel_layout: "stereo", sample_rate: "48000" }] },
    { label: "portrait VFR within exact coded-pixel budget", duration: "300.000", sampleCount: 9_000,
      frameRate: "30/1", realFrameRate: "120/1", width: 2_160, height: 3_840, codedWidth: 2_160, codedHeight: 3_840 },
  ]) {
    await context.test(fixture.label, async () => {
      const { sampleCount, duration } = fixture;
      const { width, height, codedWidth, codedHeight } = { ...validJob().structural, ...fixture };
      const runProcess = fakeRunner({
        probe: videoProbe({ ...fixture, rotation: 0, frameCount: String(sampleCount) }),
        deliveryProbe: videoProbe({ rotation: 0, duration, frameRate: "60/1" }),
      });
      let uploads = 0;
      const result = await runVideoVerifierJob(validJob({
        structural: { ...validJob().structural, width, height, codedWidth, codedHeight, sampleCount,
          durationMs: Number(duration) * 1_000, sourceAdmissionRevision: VIDEO_VERIFIER_SOURCE_ADMISSION_REVISION },
      }), {
        config: getVideoVerifierServiceConfig(ENV),
        fetchImpl: async (url, request) => {
          if (request.method === "PUT") { uploads += 1; return new Response(null, { status: 200 }); }
          return new Response(SOURCE, {
            status: 200,
            headers: { "content-type": "video/mp4", "content-length": String(SOURCE.byteLength), etag: ETAG },
          });
        },
        runProcess,
        signal: AbortSignal.timeout(5_000),
      });
      assert.equal(result.video.durationMs, Number(duration) * 1_000);
      assert.equal(uploads, 1);
      const sourceProbe = runProcess.calls.find((call) => call.executable === "ffprobe");
      assert.match(sourceProbe.args[sourceProbe.args.indexOf("-show_entries") + 1], /,nb_frames,/);
      const creation = runProcess.calls.find((call) => call.executable === "ffmpeg" && call.args.at(-1)?.endsWith("delivery.mp4"));
      assert.match(creation.args[creation.args.indexOf("-vf") + 1], /^fps=60,/);
      assert.equal(runProcess.calls.some((call) => call.executable === "ffmpeg"
        && call.args.includes("null") && call.args.some((arg) => String(arg).endsWith("delivery.mp4"))), true,
      "output still receives a complete decode after normalization");
    });
  }
});

test("source count agreement never relaxes unknown counts, disagreement, or delivery work", async (context) => {
  for (const fixture of [
    ...[undefined, "N/A", "0", "-1", "18000.5", "9007199254740992"].map((frameCount) => ({
      label: `conservative count ${frameCount}`, frameCount, realFrameRate: "120/1",
    })),
    { label: "explicit frame-count disagreement", frameCount: "17999", realFrameRate: "30/1" },
    { label: "delivery estimate is not replaced by the signed source count", frameCount: "18000", realFrameRate: "30/1",
      // This rounded rate is within the FPS tolerance but exceeds the fixed
      // delivery sample-count budget over ten minutes. Remux carries the source
      // envelope, but must not inherit the source-only exact-count exception.
      deliveryProbe: videoProbe({ rotation: 0, duration: "600.000", frameRate: "60005/1000", frameCount: "18000" }) },
  ]) {
    await context.test(fixture.label, async () => {
      const runProcess = fakeRunner({
        probe: videoProbe({ rotation: 0, duration: "600.000", frameRate: "30/1",
          realFrameRate: fixture.realFrameRate, frameCount: fixture.frameCount }),
        ...(fixture.deliveryProbe ? { deliveryProbe: fixture.deliveryProbe } : {}),
      });
      await assert.rejects(() => runVideoVerifierJob(validJob({
        structural: { ...validJob().structural, sampleCount: 18_000, durationMs: 600_000 },
      }), {
        config: getVideoVerifierServiceConfig(ENV),
        fetchImpl: async (url, request) => {
          assert.notEqual(request.method, "PUT", "a rejected probe cannot publish a delivery");
          return new Response(SOURCE, {
            status: 200,
            headers: { "content-type": "video/mp4", "content-length": String(SOURCE.byteLength), etag: ETAG },
          });
        },
        runProcess,
        signal: AbortSignal.timeout(5_000),
      }), { code: "unsupported_media" });
      if (!fixture.deliveryProbe) {
        assert.equal(runProcess.calls.some((call) => call.executable === "ffmpeg"), false,
          "source disagreement or an unbounded estimate stops before decoding");
      }
    });
  }
});

test("authoritative worker accepts an exact iPhone HEVC MOV and emits only sanitized H.264 MP4", async () => {
  const root = await mkdtemp(join(tmpdir(), "pit-verifier-mov-"));
  const movProbe = videoProbe({
    codec: "hevc",
    profile: "Main 10",
    level: 120,
    pixelFormat: "yuv420p10le",
    majorBrand: "qt  ",
    compatibleBrands: "qt  ",
    metadataStreams: Array.from({
      length: VIDEO_VERIFIER_MAX_DISCARDED_QUICKTIME_TRACKS,
    }, () => ({ codec_type: "data", codec_name: "none", codec_tag_string: "mebx" })),
  });
  const runProcess = fakeRunner({ probe: movProbe });
  const base = validJob();
  const payload = validJob({
    object: {
      ...base.object,
      key: "users/u_video/post/iphone.mov",
      contentType: "video/quicktime",
      downloadUrl: capabilityUrl("iphone.mov"),
    },
    structural: {
      ...base.structural,
      sourceContainer: "quicktime",
      sourceCodec: "hevc",
    },
  });
  const fetchImpl = async (url, request) => {
    if (request.method === "PUT") return new Response(null, { status: 200 });
    return new Response(SOURCE, {
      status: 200,
      headers: {
        "content-type": "video/quicktime",
        "content-length": String(SOURCE.byteLength),
        etag: ETAG,
      },
    });
  };
  try {
    const result = await runVideoVerifierJob(payload, {
      config: getVideoVerifierServiceConfig(ENV),
      fetchImpl,
      runProcess,
      signal: AbortSignal.timeout(5_000),
      temporaryRoot: root,
    });
    assert.equal(result.object.contentType, "video/quicktime");
    assert.equal(result.video.codec, "hevc");
    assert.equal(result.delivery.contentType, "video/mp4");
    assert.equal(result.delivery.codec, "h264");
    const sourceConsumers = runProcess.calls.filter((call) => call.args.some((value) => String(value).endsWith("source.mov")));
    assert.equal(sourceConsumers.length, 2, "one metadata probe and one full transcode consume the source");
    assert.equal(sourceConsumers.every((call) => call.args.includes("-protocol_whitelist")
      && call.args.includes("file,pipe") && call.args.includes("-f") && call.args.includes("mov")), true);
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("authoritative worker accepts the reviewed iPhone AVC probe shape", async () => {
  const root = await mkdtemp(join(tmpdir(), "pit-verifier-iphone-avc-"));
  const metadataStreams = [
    {
      codec_type: "audio",
      codec_name: "aac",
      codec_tag_string: "mp4a",
      profile: "LC",
      channels: 2,
      channel_layout: "stereo",
      sample_rate: "44100",
    },
    ...Array.from({ length: 5 }, () => ({
      codec_type: "data",
      codec_name: "none",
      codec_tag_string: "mebx",
    })),
  ];
  const runProcess = fakeRunner({
    probe: videoProbe({
      rotation: 0,
      majorBrand: "qt  ",
      compatibleBrands: "qt  ",
      omitSampleAspectRatio: true,
      codedHeight: 1_080,
      metadataStreams,
    }),
    deliveryProbe: videoProbe({
      rotation: 0,
      codedHeight: 1_080,
      omitSampleAspectRatio: true,
      metadataStreams: [metadataStreams[0]],
    }),
  });
  const base = validJob();
  const payload = validJob({
    object: {
      ...base.object,
      key: "users/u_video/post/iphone-avc.mov",
      contentType: "video/quicktime",
      downloadUrl: capabilityUrl("iphone-avc.mov"),
    },
    structural: {
      ...base.structural,
      sourceContainer: "quicktime",
      sourceCodec: "h264",
    },
  });
  try {
    const result = await runVideoVerifierJob(payload, {
      config: getVideoVerifierServiceConfig(ENV),
      fetchImpl: async (_url, request) => request.method === "PUT"
        ? new Response(null, { status: 200 })
        : new Response(SOURCE, {
          status: 200,
          headers: {
            "content-type": "video/quicktime",
            "content-length": String(SOURCE.byteLength),
            etag: ETAG,
          },
        }),
      runProcess,
      signal: AbortSignal.timeout(5_000),
      temporaryRoot: root,
    });
    assert.equal(result.video.codec, "h264");
    assert.equal(result.video.codedHeight, 1_080,
      "FFprobe may report the signed display axis for cropped AVC");
    assert.equal(result.delivery.contentType, "video/mp4");
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sanitized AVC derivative accepts display or rounded coded-axis reports", async (context) => {
  for (const codedHeight of [1_080, 1_088]) {
    await context.test(String(codedHeight), async () => {
      const root = await mkdtemp(join(tmpdir(), "pit-verifier-delivery-axis-"));
      const runProcess = fakeRunner({
        deliveryProbe: videoProbe({
          rotation: 0,
          width: 1_920,
          height: 1_080,
          codedWidth: 1_920,
          codedHeight,
        }),
        posterProbe: JSON.stringify({
          streams: [{ codec_type: "video", codec_name: "mjpeg", width: 1_280, height: 720 }],
        }),
      });
      try {
        const result = await runVideoVerifierJob(validJob(), {
          config: getVideoVerifierServiceConfig(ENV),
          fetchImpl: async (_url, request) => request.method === "PUT"
            ? new Response(null, { status: 200 })
            : new Response(SOURCE, {
              status: 200,
              headers: {
                "content-type": "video/mp4",
                "content-length": String(SOURCE.byteLength),
                etag: ETAG,
              },
            }),
          runProcess,
          signal: AbortSignal.timeout(5_000),
          temporaryRoot: root,
        });
        assert.equal(result.delivery.width, 1_920);
        assert.equal(result.delivery.height, 1_080);
        assert.deepEqual({ width: result.poster.width, height: result.poster.height }, {
          width: 1_280, height: 720,
        });
        assert.deepEqual(await readdir(root), []);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test("authoritative worker bounds QuickTime metadata and source report ambiguity", async (context) => {
  const base = validJob();
  const payload = validJob({
    object: {
      ...base.object,
      key: "users/u_video/post/iphone-bounds.mov",
      contentType: "video/quicktime",
      downloadUrl: capabilityUrl("iphone-bounds.mov"),
    },
    structural: {
      ...base.structural,
      sourceContainer: "quicktime",
      sourceCodec: "h264",
    },
  });
  const mebx = () => ({ codec_type: "data", codec_name: "none", codec_tag_string: "mebx" });
  for (const fixture of [
    {
      label: "nine-disposable-tracks",
      probe: videoProbe({
        majorBrand: "qt  ", compatibleBrands: "qt  ",
        metadataStreams: Array.from({
          length: VIDEO_VERIFIER_MAX_DISCARDED_QUICKTIME_TRACKS + 1,
        }, mebx),
      }),
    },
    {
      label: "unknown-data-track",
      probe: videoProbe({
        majorBrand: "qt  ", compatibleBrands: "qt  ",
        metadataStreams: [{ codec_type: "data", codec_name: "none", codec_tag_string: "zzzz" }],
      }),
    },
    {
      label: "anamorphic-signal",
      probe: videoProbe({
        majorBrand: "qt  ", compatibleBrands: "qt  ", sampleAspectRatio: "4:3",
      }),
    },
    {
      label: "missing-aspect-signal",
      probe: videoProbe({
        majorBrand: "qt  ", compatibleBrands: "qt  ", sampleAspectRatio: "",
      }),
    },
    {
      label: "coded-axis-below-display",
      probe: videoProbe({
        majorBrand: "qt  ", compatibleBrands: "qt  ", codedHeight: 1_079,
      }),
    },
    {
      label: "coded-axis-between-display-and-envelope",
      probe: videoProbe({
        majorBrand: "qt  ", compatibleBrands: "qt  ", codedHeight: 1_081,
      }),
    },
    {
      label: "coded-axis-above-envelope",
      probe: videoProbe({
        majorBrand: "qt  ", compatibleBrands: "qt  ", codedHeight: 1_096,
      }),
    },
  ]) {
    await context.test(fixture.label, async () => {
      const root = await mkdtemp(join(tmpdir(), "pit-verifier-iphone-reject-"));
      try {
        await assert.rejects(() => runVideoVerifierJob(payload, {
          config: getVideoVerifierServiceConfig(ENV),
          fetchImpl: async () => new Response(SOURCE, {
            status: 200,
            headers: {
              "content-type": "video/quicktime",
              "content-length": String(SOURCE.byteLength),
              etag: ETAG,
            },
          }),
          runProcess: fakeRunner({ probe: fixture.probe }),
          signal: AbortSignal.timeout(5_000),
          temporaryRoot: root,
        }), { code: "unsupported_media" });
        assert.deepEqual(await readdir(root), []);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test("authoritative worker accepts ISO-MP4 hvc1 Main/Main 10 and emits only sanitized H.264 MP4", async (context) => {
  for (const fixture of [
    { label: "main-8-bit", profile: "Main", pixelFormat: "yuv420p" },
    { label: "main10-10-bit", profile: "Main 10", pixelFormat: "yuv420p10le" },
  ]) {
    await context.test(fixture.label, async () => {
      const root = await mkdtemp(join(tmpdir(), "pit-verifier-hevc-mp4-"));
      const probe = videoProbe({
        codec: "hevc",
        codecTag: "hvc1",
        profile: fixture.profile,
        level: 120,
        pixelFormat: fixture.pixelFormat,
        majorBrand: "isom",
        compatibleBrands: "isomiso6hvc1mp42",
        codedHeight: 1_080,
      });
      const runProcess = fakeRunner({ probe });
      const payload = validJob({
        structural: { ...validJob().structural, sourceCodec: "hevc" },
      });
      try {
        const result = await runVideoVerifierJob(payload, {
          config: getVideoVerifierServiceConfig(ENV),
          fetchImpl: async (url, request) => {
            if (request.method === "PUT") return new Response(null, { status: 200 });
            return new Response(SOURCE, {
              status: 200,
              headers: {
                "content-type": "video/mp4",
                "content-length": String(SOURCE.byteLength),
                etag: ETAG,
              },
            });
          },
          runProcess,
          signal: AbortSignal.timeout(5_000),
          temporaryRoot: root,
        });
        assert.equal(result.object.contentType, "video/mp4");
        assert.equal(result.video.codec, "hevc");
        assert.equal(result.video.codedHeight, 1_080,
          "HEVC coded dimensions remain decoder-bounded instead of using AVC macroblock equality");
        assert.equal(result.delivery.contentType, "video/mp4");
        assert.equal(result.delivery.codec, "h264");
        assert.equal(runProcess.calls.some((call) => call.executable === "ffmpeg"
          && call.args.includes("libx264")
          && call.args.some((value) => String(value).endsWith("delivery.mp4"))), true);
        assert.deepEqual(await readdir(root), []);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test("ISO-MP4 HEVC rejects hev1, Dolby Vision, encrypted tags, and unsupported profiles", async (context) => {
  const cases = [
    { label: "hev1", probe: { codecTag: "hev1" } },
    { label: "dolby-dvhe", probe: { codecTag: "dvhe" } },
    { label: "dolby-dvh1", probe: { codecTag: "dvh1" } },
    { label: "encrypted", probe: { codecTag: "encv" } },
    { label: "unsupported-profile", probe: { profile: "Main 12" } },
    { label: "main-with-10-bit", probe: { profile: "Main", pixelFormat: "yuv420p10le" } },
    { label: "main10-with-12-bit", probe: { profile: "Main 10", pixelFormat: "yuv420p12le" } },
  ];
  for (const fixture of cases) {
    await context.test(fixture.label, async () => {
      const root = await mkdtemp(join(tmpdir(), "pit-verifier-hevc-reject-"));
      try {
        await assert.rejects(() => runVideoVerifierJob(validJob({
          structural: { ...validJob().structural, sourceCodec: "hevc" },
        }), {
          config: getVideoVerifierServiceConfig(ENV),
          fetchImpl: async () => new Response(SOURCE, {
            status: 200,
            headers: { "content-type": "video/mp4", "content-length": String(SOURCE.byteLength), etag: ETAG },
          }),
          runProcess: fakeRunner({
            probe: videoProbe({
              codec: "hevc",
              codecTag: "hvc1",
              profile: "Main 10",
              pixelFormat: "yuv420p10le",
              majorBrand: "isom",
              compatibleBrands: "isomiso6hvc1mp42",
              ...fixture.probe,
            }),
          }),
          signal: AbortSignal.timeout(5_000),
          temporaryRoot: root,
        }), { code: "unsupported_media" });
        assert.deepEqual(await readdir(root), []);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test("MP4 mode independently rejects QuickTime brands, textual or anamorphic pixels, and fields", async () => {
  for (const probe of [
    videoProbe({ majorBrand: "qt  ", compatibleBrands: "qt  " }),
    videoProbe({ sampleAspectRatio: "4:3" }),
    videoProbe({ sampleAspectRatio: "N/A" }),
    videoProbe({ fieldOrder: "tt" }),
  ]) {
    const root = await mkdtemp(join(tmpdir(), "pit-verifier-reject-"));
    try {
      await assert.rejects(() => runVideoVerifierJob(validJob(), {
        config: getVideoVerifierServiceConfig(ENV),
        fetchImpl: async () => new Response(SOURCE, {
          status: 200,
          headers: { "content-type": "video/mp4", "content-length": String(SOURCE.byteLength), etag: ETAG },
        }),
        runProcess: fakeRunner({ probe }),
        signal: AbortSignal.timeout(5_000),
        temporaryRoot: root,
      }), { code: "unsupported_media" });
      assert.deepEqual(await readdir(root), []);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("direct worker entrypoint listens on an explicit allowed port", async () => {
  const port = await new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const value = probe.address().port;
      probe.close((error) => error ? reject(error) : resolve(value));
    });
  });
  const child = spawn(process.execPath, [fileURLToPath(new URL("./videoVerifierService.js", import.meta.url))], {
    env: {
      ...process.env,
      PORT: String(port),
      PIT_VIDEO_VERIFIER_SECRET: SECRET,
      PIT_VIDEO_SOURCE_ORIGIN: "https://objects.example.com/s3",
      PIT_VIDEO_SOURCE_BUCKET: "pit-media",
      PIT_VIDEO_OUTPUT_ORIGIN: "https://objects.example.com/s3",
      PIT_VIDEO_OUTPUT_BUCKET: "pit-media-public",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  try {
    for (let index = 0; index < 100 && !stdout.includes("listening on port"); index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.match(stdout, new RegExp(`listening on port ${port}`), stderr);
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM");
    await exited;
  }
});

function universalJob({ extension = "webm", contentType = "video/webm", posterTimeMs = 2_000 } = {}) {
  const base = validJob();
  const { structural, ...rest } = base;
  void structural;
  return {
    ...rest,
    admission: VIDEO_VERIFIER_UNIVERSAL_ADMISSION,
    object: {
      ...base.object,
      key: `users/u_video/post/source.${extension}`,
      contentType,
      downloadUrl: capabilityUrl(`source.${extension}`),
    },
    poster: { ...base.poster, timeMs: posterTimeMs },
  };
}

function universalProbe({ streams, duration = "12.000" }) {
  return JSON.stringify({ streams, format: { format_name: "matroska,webm", duration } });
}

function universalRunner({ probe, failTranscode = false, failProbe = false }) {
  const calls = [];
  const runProcess = async (executable, args, options) => {
    calls.push({ executable, args: [...args], options });
    const sourceArg = args.some((value) => /source\.[a-z0-9]+$/.test(String(value)) && !String(value).endsWith(".mp4"));
    if (executable === "ffprobe" && sourceArg) {
      if (failProbe) throw Object.assign(new Error("probe failed"), { status: 422, code: "decode_failed" });
      return { stdout: probe, stderr: "" };
    }
    if (executable === "ffprobe" && args.some((value) => String(value).endsWith("delivery.mp4"))) {
      return { stdout: videoProbe({ rotation: 0, width: 1_080, height: 1_920, codedWidth: 1_088, codedHeight: 1_920 }), stderr: "" };
    }
    if (executable === "ffprobe") {
      return { stdout: JSON.stringify({ streams: [{ codec_type: "video", codec_name: "mjpeg", width: 720, height: 1_280 }] }), stderr: "" };
    }
    const output = args.at(-1);
    if (failTranscode && typeof output === "string" && output.endsWith("delivery.mp4")) {
      throw Object.assign(new Error("decoder exit=1"), { status: 422, code: "decode_failed" });
    }
    if (typeof output === "string" && output.endsWith("poster.jpg")) await writeFile(output, POSTER);
    if (typeof output === "string" && output.endsWith("delivery.mp4")) await writeFile(output, SOURCE);
    return { stdout: "", stderr: "" };
  };
  runProcess.calls = calls;
  return runProcess;
}

function universalFetch(contentType) {
  return async (url, request) => {
    if (request.method === "PUT") return new Response(null, { status: 200 });
    return new Response(SOURCE, {
      status: 200,
      headers: { "content-type": contentType, "content-length": String(SOURCE.byteLength), etag: ETAG },
    });
  };
}

async function runUniversal(job, runProcess, contentType) {
  const root = await mkdtemp(join(tmpdir(), "pit-verifier-universal-"));
  try {
    const result = await runVideoVerifierJob(job, {
      config: getVideoVerifierServiceConfig(ENV),
      fetchImpl: universalFetch(contentType),
      runProcess,
      signal: AbortSignal.timeout(5_000),
      temporaryRoot: root,
    });
    assert.deepEqual(await readdir(root), [], "temporary files are removed");
    return result;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("universal jobs take any listed container without the MP4 structural proof", () => {
  const config = getVideoVerifierServiceConfig(ENV);
  const accepted = validateVideoVerifierJob(universalJob(), config);
  assert.equal(accepted.universal, true);
  assert.equal(accepted.structural, null);
  assert.equal(validateVideoVerifierJob(universalJob({ extension: "avi", contentType: "video/x-msvideo" }), config).contentType, "video/x-msvideo");
  assert.equal(validateVideoVerifierJob(universalJob({ posterTimeMs: MEDIA_VIDEO_MAX_DURATION_MS - 1 }), config).poster.timeMs, MEDIA_VIDEO_MAX_DURATION_MS - 1,
    "the length is unknown until the worker reads the file");
  assert.throws(() => validateVideoVerifierJob(universalJob({ posterTimeMs: MEDIA_VIDEO_MAX_DURATION_MS }), config));
  assert.throws(() => validateVideoVerifierJob(universalJob({ extension: "avi", contentType: "video/webm" }), config),
    (error) => error.code === "invalid_request", "the key extension must match the declared container");
  assert.throws(() => validateVideoVerifierJob({ ...universalJob(), admission: undefined }, config),
    "without universal admission a WebM still needs the MP4/MOV proof");
  assert.throws(() => validateVideoVerifierJob({ ...universalJob(), admission: "everything" }, config),
    (error) => error.code === "incompatible_protocol");
});

test("a WebM with VP9, Opus, cover art and subtitles converts to H.264/AAC from forced demuxing", async () => {
  const probe = universalProbe({ streams: [
    { index: 0, codec_type: "video", codec_name: "mjpeg", width: 600, height: 600, disposition: { attached_pic: 1 } },
    { index: 1, codec_type: "video", codec_name: "vp9", width: 1_080, height: 1_920, field_order: "progressive", avg_frame_rate: "0/0", r_frame_rate: "1000/1", disposition: { attached_pic: 0 } },
    { index: 2, codec_type: "subtitle", codec_name: "webvtt" },
    { index: 3, codec_type: "audio", codec_name: "opus", channels: 2 },
  ] });
  const runProcess = universalRunner({ probe });
  const result = await runUniversal(universalJob({ posterTimeMs: 11_990 }), runProcess, "video/webm");
  assert.equal(result.video.codec, "vp9");
  assert.equal(result.video.audioCodec, "opus");
  assert.equal(result.delivery.codec, "h264");
  assert.equal(result.poster.timeMs, 9_750, "the cover stays clear of the last frames of the shorter of source and copy");
  assert.equal(Object.hasOwn(result.video, "demuxer"), false, "internal probe fields stay inside the worker");

  const sourceCalls = runProcess.calls.filter((call) => call.args.some((value) => String(value).endsWith("source.webm")));
  assert.equal(sourceCalls.length, 2, "one probe and one conversion read the member file");
  for (const call of sourceCalls) {
    assert.deepEqual(call.args.slice(call.args.indexOf("-f"), call.args.indexOf("-f") + 2), ["-f", "matroska"], "never format guessing");
    assert.ok(call.args.includes("-protocol_whitelist") && call.args.includes("file,pipe"));
  }
  const transcode = sourceCalls.find((call) => call.executable === "ffmpeg").args;
  assert.deepEqual(transcode.filter((value, index) => transcode[index - 1] === "-map"), ["0:1", "0:3"],
    "the real picture and first decodable audio, never the cover art or subtitles");
  assert.equal(transcode.includes("-xerror"), false, "a phone recording with one bad frame still converts");
  const filter = transcode[transcode.indexOf("-vf") + 1];
  assert.match(filter, /^fps=30,/, "an unbelievable 1000 fps timebase delivers at 30");
  assert.match(filter, /if\(gt\(iw,ih\),min\(1920,iw\),min\(1080,iw\)\)/, "portrait keeps its 1080 width");
  assert.ok(transcode.includes("libx264") && transcode.includes("aac"));
  assert.ok(transcode.includes("-map_metadata") && transcode.includes("-1"), "metadata including location is dropped");
  const outputDecode = runProcess.calls.find((call) => call.executable === "ffmpeg"
    && call.args.some((value) => String(value).endsWith("delivery.mp4")) && call.args.at(-1) === "-");
  assert.ok(outputDecode.args.includes("-xerror"), "the published copy is still decoded strictly");
});

test("interlaced, non-square MPEG is deinterlaced and squared before bounding", async () => {
  const probe = universalProbe({ streams: [
    { index: 0, codec_type: "video", codec_name: "mpeg2video", width: 720, height: 480, field_order: "tt", sample_aspect_ratio: "32:27", avg_frame_rate: "30000/1001", r_frame_rate: "30000/1001" },
    { index: 1, codec_type: "audio", codec_name: "mp2", channels: 2 },
  ] });
  const runProcess = universalRunner({ probe });
  await runUniversal(universalJob({ extension: "mpg", contentType: "video/mpeg" }), runProcess, "video/mpeg");
  const transcode = runProcess.calls.find((call) => call.executable === "ffmpeg" && call.args.some((value) => String(value).endsWith("source.mpg"))).args;
  assert.deepEqual(transcode.slice(transcode.indexOf("-f"), transcode.indexOf("-f") + 2), ["-f", "mpeg"]);
  assert.match(transcode[transcode.indexOf("-vf") + 1], /^yadif=deint=interlaced,fps=30,scale=w='trunc\(iw\*sar\/2\)\*2':h=ih,setsar=1,/);
});

test("universal sources the worker cannot read are signed source rejections, not retryable faults", async () => {
  const cases = [
    ["no decodable picture", { probe: universalProbe({ streams: [
      { index: 0, codec_type: "video", codec_name: "av1", width: 1_280, height: 720 },
      { index: 1, codec_type: "audio", codec_name: "opus", channels: 2 },
    ] }) }],
    ["over ten minutes", { probe: universalProbe({ duration: String(MEDIA_VIDEO_MAX_DURATION_MS / 1_000 + 1), streams: [
      { index: 0, codec_type: "video", codec_name: "vp8", width: 640, height: 360, avg_frame_rate: "30/1", r_frame_rate: "30/1" },
    ] }) }],
    ["unreadable file", { probe: "", failProbe: true }],
    ["damaged beyond decoding", { failTranscode: true, probe: universalProbe({ streams: [
      { index: 0, codec_type: "video", codec_name: "vp8", width: 640, height: 360, avg_frame_rate: "30/1", r_frame_rate: "30/1" },
    ] }) }],
  ];
  for (const [label, options] of cases) {
    await assert.rejects(() => runUniversal(universalJob(), universalRunner(options), "video/webm"),
      (error) => error.code === "unsupported_media" && error.status === 422, label);
  }
});

test("a browser-recorded WebM that stores no length converts and takes the copy's measured length", async () => {
  const probe = JSON.stringify({
    streams: [
      { index: 0, codec_type: "video", codec_name: "vp8", width: 1_280, height: 720, avg_frame_rate: "0/0", r_frame_rate: "1000/1" },
      { index: 1, codec_type: "audio", codec_name: "opus", channels: 1 },
    ],
    format: { format_name: "matroska,webm" },
  });
  const runProcess = universalRunner({ probe });
  const result = await runUniversal(universalJob({ posterTimeMs: 0 }), runProcess, "video/webm");
  assert.equal(result.video.durationMs, 10_000, "measured from the converted copy");
  assert.equal(result.delivery.durationMs, 10_000);
  assert.equal(result.poster.timeMs, 0);
  const transcode = runProcess.calls.find((call) => call.executable === "ffmpeg" && call.args.some((value) => String(value).endsWith("source.webm"))).args;
  assert.ok(transcode.includes("-maxrate"), "an unknown length is budgeted as the longest allowed clip");
});
