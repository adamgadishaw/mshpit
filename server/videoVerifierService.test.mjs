import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  createVideoVerifierService,
  getVideoVerifierServiceConfig,
  runVideoVerifierJob,
  validateVideoVerifierJob,
} from "./videoVerifierService.js";
import {
  signVideoVerifierRequest,
  verifyVideoVerifierResponse,
  VIDEO_VERIFIER_MAX_DISCARDED_QUICKTIME_TRACKS,
  VIDEO_VERIFIER_PROTOCOL_VERSION,
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
  const signedHeaders = encodeURIComponent("content-type;host;if-none-match");
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
      uploadHeaders: { "Content-Type": "video/mp4", "If-None-Match": "*" },
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
    structural: { ...validJob().structural, sourceCodec: "hevc" },
  }), config).structural.sourceCodec, "hevc");
  assert.throws(() => validateVideoVerifierJob(validJob({
    object: { ...validJob().object, downloadUrl: capabilityUrl().replace("objects.example.com", "evil.example.com") },
  }), config), { code: "invalid_request" });
  assert.throws(() => validateVideoVerifierJob(validJob({
    structural: { ...validJob().structural, sampleCount: 3_601, durationMs: 60_000 },
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
      avg_frame_rate: "30/1",
      r_frame_rate: "30/1",
      disposition: { attached_pic: 0 },
      tags: rotation ? { rotate: String(rotation) } : {},
      side_data_list: rotation ? [{ rotation }] : [],
    }, ...metadataStreams],
    format: {
      format_name: "mov,mp4,m4a,3gp,3g2,mj2",
      duration: "10.000",
      tags: { major_brand: majorBrand, compatible_brands: compatibleBrands },
    },
  });
}

function fakeRunner({
  probe = videoProbe(),
  deliveryProbe = videoProbe({
    rotation: 0, width: 720, height: 1_280, codedWidth: 720, codedHeight: 1_280,
  }),
  posterProbe = JSON.stringify({
    streams: [{ codec_type: "video", codec_name: "mjpeg", width: 720, height: 1_280 }],
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

test("authoritative job forces local demux/full decode, preserves rotation, and cleans random temp state", async () => {
  const root = await mkdtemp(join(tmpdir(), "pit-verifier-test-"));
  const runProcess = fakeRunner();
  const fetchImpl = async (url, request) => {
    assert.equal(new URL(url).origin, "https://objects.example.com");
    assert.equal(request.redirect, "error");
    if (request.method === "PUT") {
      assert.equal(new URL(url).pathname.endsWith("/pit-media-public/users/u_video/post/delivery.mp4"), true);
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
    assert.equal(result.video.rotation, 90);
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
      width: 720,
      height: 1_280,
      rotation: 0,
      uploadStatus: "created",
    });
    assert.match(result.delivery.sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual({ width: result.poster.width, height: result.poster.height }, { width: 720, height: 1_280 });
    const ffmpegCalls = runProcess.calls.filter((call) => call.executable === "ffmpeg");
    assert.equal(ffmpegCalls.some((call) => call.args.includes("-f") && call.args.includes("mov")
      && call.args.includes("-protocol_whitelist")), true);
    assert.equal(ffmpegCalls.some((call) => call.args.includes("-map") && call.args.includes("0:v:0")
      && call.args.includes("0:a:0?")), true);
    assert.equal(ffmpegCalls.some((call) => call.args.includes("libx264")
      && call.args.includes("-maxrate") && call.args.includes("11M")
      && call.args.includes("-bufsize") && call.args.includes("22M")
      && call.args.includes("-map_metadata") && call.args.includes("-map_chapters")
      && call.args.some((value) => String(value).endsWith("delivery.mp4"))), true);
    assert.equal(ffmpegCalls.some((call) => call.args.includes("-flags:v")
      && call.args.includes("+bitexact")
      && call.args.some((value) => String(value).endsWith("poster.jpg"))), true,
    "worker covers must omit FFmpeg's Lavc comment metadata");
    const sourceConsumers = runProcess.calls.filter((call) => call.args.some((value) => String(value).endsWith("source.mp4")));
    assert.equal(sourceConsumers.length, 2, "one metadata probe and one full transcode consume the source");
    assert.equal(sourceConsumers.every((call) => call.args.includes("-protocol_whitelist")
      && call.args.includes("file,pipe") && call.args.includes("-f") && call.args.includes("mov")), true);
    assert.equal(sourceConsumers.some((call) => JSON.stringify(call.args).includes("https://")
      || JSON.stringify(call.args).includes(SECRET)), false);
    assert.deepEqual(await readdir(root), [], "all per-job temp directories are removed");
  } finally {
    await rm(root, { recursive: true, force: true });
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
  const runProcess = fakeRunner({ probe: videoProbe({
    rotation: 0,
    majorBrand: "qt  ",
    compatibleBrands: "qt  ",
    omitSampleAspectRatio: true,
    codedHeight: 1_080,
    metadataStreams,
  }) });
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

test("MP4 mode independently rejects QuickTime brands, missing or anamorphic pixels, and fields", async () => {
  for (const probe of [
    videoProbe({ majorBrand: "qt  ", compatibleBrands: "qt  " }),
    videoProbe({ sampleAspectRatio: "4:3" }),
    videoProbe({ sampleAspectRatio: "N/A" }),
    videoProbe({ omitSampleAspectRatio: true }),
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
