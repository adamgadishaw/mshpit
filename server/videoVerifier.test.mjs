import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { afterEach } from "node:test";

import {
  getVideoVerifierConfig,
  refreshVideoVerifierHealth,
  resetVideoVerifierStateForTests,
  startVideoVerifierHealthScheduler,
  verifyVideoObject,
  videoVerifierRuntimeStatus,
  VIDEO_VERIFIER_HEALTH_FRESH_MS,
} from "./videoVerifier.js";
import {
  signVideoVerifierResponse,
  verifyVideoVerifierRequest,
  VIDEO_VERIFIER_PIPELINE_VERSION,
  VIDEO_VERIFIER_PROTOCOL_VERSION,
} from "./videoVerifierProtocol.js";
import { verifyPrivateMediaBucketIsolation } from "./media.js";

const SECRET = "video-verifier-test-secret-that-is-at-least-thirty-two-bytes";
const ENV = Object.freeze({
  NODE_ENV: "production",
  PIT_VIDEO_VERIFIER_HOSTPORT: "pit-video-verifier:10001",
  PIT_VIDEO_VERIFIER_SECRET: SECRET,
  MEDIA_ENDPOINT: "https://objects.example.com/s3",
  MEDIA_BUCKET: "pit-media",
  MEDIA_SOURCE_BUCKET: "pit-media-private",
  MEDIA_REGION: "auto",
  MEDIA_ACCESS_KEY_ID: "media-test-access",
  MEDIA_SECRET_ACCESS_KEY: "media-test-secret",
  MEDIA_PUBLIC_BASE_URL: "https://media.example.com/cdn",
});
const POSTER = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0xff, 0xd9]);
const STRUCTURAL = Object.freeze({
  width: 1_920,
  height: 1_080,
  codedWidth: 1_920,
  codedHeight: 1_088,
  sampleCount: 300,
  durationMs: 10_000,
});

await verifyPrivateMediaBucketIsolation({
  env: ENV,
  fetchImpl: async () => ({ status: 403 }),
});

afterEach(() => resetVideoVerifierStateForTests());

function signedResponse({ path, request, payload, status = 200 }) {
  const authenticated = verifyVideoVerifierRequest({
    secret: SECRET,
    path,
    body: request.body,
    headers: request.headers,
  });
  const signed = signVideoVerifierResponse({
    secret: SECRET,
    path,
    requestNonce: authenticated.nonce,
    payload: typeof payload === "function" ? payload(authenticated.payload) : payload,
  });
  return new Response(signed.body, { status, headers: signed.headers });
}

function healthyPayload() {
  return {
    ok: true,
    protocol: VIDEO_VERIFIER_PROTOCOL_VERSION,
    pipeline: VIDEO_VERIFIER_PIPELINE_VERSION,
    decoder: { ffmpeg: true, ffprobe: true, version: "ffmpeg test" },
    poster: { generated: true, decoded: true },
    storage: { privateInput: true, sanitizedOutput: true },
    sourceTypes: ["video/mp4", "video/quicktime"],
    sourceCodecs: {
      "video/mp4": ["h264", "hevc"],
      "video/quicktime": ["h264", "hevc"],
    },
    concurrency: 1,
  };
}

function decodedPayload(requestPayload) {
  return {
    ok: true,
    protocol: VIDEO_VERIFIER_PROTOCOL_VERSION,
    pipeline: VIDEO_VERIFIER_PIPELINE_VERSION,
    object: {
      key: requestPayload.object.key,
      byteSize: requestPayload.object.byteSize,
      contentType: requestPayload.object.contentType,
      etag: requestPayload.object.etag,
    },
    video: {
      codec: requestPayload.structural.sourceCodec || "h264",
      audioCodec: "none",
      rotation: 0,
      width: requestPayload.structural.width,
      height: requestPayload.structural.height,
      codedWidth: requestPayload.structural.codedWidth,
      codedHeight: requestPayload.structural.codedHeight,
      durationMs: requestPayload.structural.durationMs,
    },
    delivery: {
      key: requestPayload.output.key,
      contentType: "video/mp4",
      byteSize: 900_000,
      sha256: "d".repeat(64),
      width: requestPayload.structural.width,
      height: requestPayload.structural.height,
      durationMs: requestPayload.structural.durationMs,
      rotation: 0,
      codec: "h264",
      audioCodec: "none",
      uploadStatus: "created",
    },
    poster: {
      contentType: "image/jpeg",
      byteSize: POSTER.byteLength,
      width: 1_280,
      height: 720,
      timeMs: requestPayload.poster.timeMs,
      sha256: createHash("sha256").update(POSTER).digest("hex"),
      dataBase64: POSTER.toString("base64"),
    },
  };
}

function verificationInput(overrides = {}) {
  return {
    objectKey: "users/u_video/post/source.mp4",
    expectedBytes: 1_000_000,
    ifMatch: '"source-generation"',
    structural: STRUCTURAL,
    posterTimeMs: 2_000,
    output: {
      key: "users/u_video/post/delivery.mp4",
      uploadUrl: "https://objects.example.com/signed-output",
      requiredHeaders: { "Content-Type": "video/mp4", "If-None-Match": "*" },
    },
    env: ENV,
    ...overrides,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

test("production verifier config requires an allowed Render private hostport", () => {
  assert.equal(getVideoVerifierConfig(ENV).configured, true);
  assert.equal(getVideoVerifierConfig({ ...ENV, PIT_VIDEO_VERIFIER_HOSTPORT: "pit-video-verifier:10000" }).configured, false);
  assert.equal(getVideoVerifierConfig({
    ...ENV,
    PIT_VIDEO_VERIFIER_HOSTPORT: "",
    PIT_VIDEO_VERIFIER_URL: "https://public-verifier.example.com",
  }).configured, false, "production never falls back to an Internet-reachable verifier URL");
  assert.equal(getVideoVerifierConfig({
    ...ENV,
    NODE_ENV: "development",
    PIT_VIDEO_VERIFIER_HOSTPORT: "",
    PIT_VIDEO_VERIFIER_URL: "http://127.0.0.1:10001",
  }).configured, true);
});

test("health readiness is fresh, exact, and a latest failed probe disables it immediately", async () => {
  const at = Date.now();
  const healthyFetch = (url, request) => signedResponse({
    path: new URL(url).pathname,
    request,
    payload: healthyPayload(),
  });
  const healthy = await refreshVideoVerifierHealth({ env: ENV, fetchImpl: healthyFetch, at });
  assert.equal(healthy.ready, true);
  assert.equal(healthy.pipeline, "private-derivative-v1");
  assert.equal(videoVerifierRuntimeStatus(ENV, at + VIDEO_VERIFIER_HEALTH_FRESH_MS + 1).ready, false);

  const failed = await refreshVideoVerifierHealth({
    env: ENV,
    fetchImpl: async () => { throw new Error("offline"); },
    at: at + 1,
  });
  assert.equal(failed.ready, false);
  assert.equal(failed.lastSuccessAt, at);
  assert.equal(failed.lastAttemptAt, at + 1);
  assert.notEqual(failed.lastErrorCode, null);
});

test("a rolling-deploy legacy worker keeps MP4 ready without advertising MOV", async () => {
  const payload = healthyPayload();
  delete payload.sourceTypes;
  delete payload.sourceCodecs;
  const status = await refreshVideoVerifierHealth({
    env: ENV,
    fetchImpl: (url, request) => signedResponse({
      path: new URL(url).pathname,
      request,
      payload,
    }),
    at: Date.now(),
  });
  assert.equal(status.ready, true);
  assert.deepEqual(status.sourceTypes, ["video/mp4"]);
  assert.deepEqual(status.sourceCodecs, { "video/mp4": ["h264"] });
});

test("a legacy worker blocks HEVC MP4 before dispatch while H.264 MP4 stays retryable", async () => {
  const payload = healthyPayload();
  delete payload.sourceTypes;
  delete payload.sourceCodecs;
  await refreshVideoVerifierHealth({
    env: ENV,
    fetchImpl: (url, request) => signedResponse({
      path: new URL(url).pathname,
      request,
      payload,
    }),
    at: Date.now(),
  });

  let verifierFetches = 0;
  const verifierFetch = (url, request) => {
    verifierFetches += 1;
    return signedResponse({ path: new URL(url).pathname, request, payload: decodedPayload });
  };
  await assert.rejects(() => verifyVideoObject(verificationInput({
    structural: { ...STRUCTURAL, sourceCodec: "hevc" },
    fetchImpl: verifierFetch,
  })), (error) => error.status === 503 && error.code === "MEDIA_STORAGE_UNAVAILABLE");
  assert.equal(verifierFetches, 0, "unsupported rolling codec never reaches the old worker");

  const h264 = await verifyVideoObject(verificationInput({ fetchImpl: verifierFetch }));
  assert.equal(h264.delivery.contentType, "video/mp4");
  assert.equal(verifierFetches, 1);
});

test("health rejects malformed codec capability claims", async () => {
  const payload = healthyPayload();
  payload.sourceCodecs["video/mp4"] = ["hevc"];
  const status = await refreshVideoVerifierHealth({
    env: ENV,
    fetchImpl: (url, request) => signedResponse({
      path: new URL(url).pathname,
      request,
      payload,
    }),
    at: Date.now(),
  });
  assert.equal(status.ready, false);
  assert.deepEqual(status.sourceTypes, []);
  assert.deepEqual(status.sourceCodecs, {});
});

test("health never infers codecs from MIME declarations alone", async () => {
  const payload = healthyPayload();
  delete payload.sourceCodecs;
  const status = await refreshVideoVerifierHealth({
    env: ENV,
    fetchImpl: (url, request) => signedResponse({
      path: new URL(url).pathname,
      request,
      payload,
    }),
    at: Date.now(),
  });
  assert.equal(status.ready, false);
  assert.deepEqual(status.sourceTypes, []);
  assert.deepEqual(status.sourceCodecs, {});
});

test("a rolling-deploy legacy worker result remains valid only for its MP4 contract", async () => {
  const result = await verifyVideoObject(verificationInput({
    fetchImpl: (url, request) => signedResponse({
      path: new URL(url).pathname,
      request,
      payload: (requestPayload) => {
        const decoded = decodedPayload(requestPayload);
        delete decoded.object.contentType;
        return decoded;
      },
    }),
  }));
  assert.equal(result.delivery.contentType, "video/mp4");

  await assert.rejects(() => verifyVideoObject(verificationInput({
    objectKey: "users/u_video/post/iphone.mov",
    contentType: "video/quicktime",
    structural: { ...STRUCTURAL, sourceContainer: "quicktime", sourceCodec: "h264" },
    fetchImpl: (url, request) => signedResponse({
      path: new URL(url).pathname,
      request,
      payload: (requestPayload) => {
        const decoded = decodedPayload(requestPayload);
        delete decoded.object.contentType;
        return decoded;
      },
    }),
  })), (error) => error.status === 503 && error.code === "MEDIA_STORAGE_UNAVAILABLE");
});

test("a successful verification preserves the source types proven by health", async () => {
  const at = Date.now();
  await refreshVideoVerifierHealth({
    env: ENV,
    at,
    fetchImpl: (url, request) => signedResponse({
      path: new URL(url).pathname,
      request,
      payload: healthyPayload(),
    }),
  });
  await verifyVideoObject(verificationInput({
    fetchImpl: (url, request) => signedResponse({
      path: new URL(url).pathname,
      request,
      payload: decodedPayload,
    }),
  }));
  assert.deepEqual(videoVerifierRuntimeStatus(ENV, at + 1).sourceTypes,
    ["video/mp4", "video/quicktime"]);
  assert.deepEqual(videoVerifierRuntimeStatus(ENV, at + 1).sourceCodecs, {
    "video/mp4": ["h264", "hevc"],
    "video/quicktime": ["h264", "hevc"],
  });
});

test("exact jobs coalesce once, while a different cover is rejected busy without charging", async () => {
  const gate = deferred();
  let fetches = 0;
  let starts = 0;
  const fetchImpl = async (url, request) => {
    fetches += 1;
    await gate.promise;
    return signedResponse({ path: new URL(url).pathname, request, payload: decodedPayload });
  };
  const first = verifyVideoObject(verificationInput({ fetchImpl, beforeStart: () => { starts += 1; } }));
  const follower = verifyVideoObject(verificationInput({ fetchImpl, beforeStart: () => { starts += 1; } }));
  await assert.rejects(
    () => verifyVideoObject(verificationInput({
      fetchImpl,
      posterTimeMs: 3_000,
      beforeStart: () => { starts += 1; },
    })),
    (error) => error.status === 429 && error.code === "RATE_LIMITED",
  );
  assert.equal(starts, 1);
  assert.equal(fetches, 1);
  gate.resolve();
  const [a, b] = await Promise.all([first, follower]);
  assert.equal(a.poster.timeMs, 2_000);
  assert.deepEqual(b, a);
});

test("a denied leader stays actor-local and a fresh caller can start the same job", async () => {
  let fetches = 0;
  await assert.rejects(
    () => verifyVideoObject(verificationInput({ beforeStart: () => { throw new Error("actor capped"); } })),
    /actor capped/,
  );
  const result = await verifyVideoObject(verificationInput({
    beforeStart: () => {},
    fetchImpl: async (url, request) => {
      fetches += 1;
      return signedResponse({ path: new URL(url).pathname, request, payload: decodedPayload });
    },
  }));
  assert.equal(fetches, 1);
  assert.equal(result.width, 1_920);
});

test("QuickTime source identity is HMAC-bound while the delivery stays MP4", async () => {
  let observed;
  const result = await verifyVideoObject(verificationInput({
    objectKey: "users/u_video/post/iphone.mov",
    contentType: "video/quicktime",
    structural: { ...STRUCTURAL, sourceContainer: "quicktime", sourceCodec: "hevc" },
    fetchImpl: async (url, request) => {
      observed = verifyVideoVerifierRequest({
        secret: SECRET,
        path: new URL(url).pathname,
        body: request.body,
        headers: request.headers,
      }).payload;
      return signedResponse({ path: new URL(url).pathname, request, payload: decodedPayload });
    },
  }));
  assert.equal(observed.object.contentType, "video/quicktime");
  assert.equal(observed.object.key.endsWith(".mov"), true);
  assert.equal(observed.output.contentType, "video/mp4");
  assert.equal(observed.output.key.endsWith(".mp4"), true);
  assert.equal(result.delivery.contentType, "video/mp4");

  await assert.rejects(() => verifyVideoObject(verificationInput({
    objectKey: "users/u_video/post/type-confusion.mp4",
    contentType: "video/quicktime",
    structural: { ...STRUCTURAL, sourceContainer: "quicktime", sourceCodec: "h264" },
    fetchImpl: async () => { throw new Error("must not call verifier"); },
  })), (error) => error.status === 500 && error.code === "INTERNAL_ERROR");
});

test("ISO-MP4 hvc1 identity is HMAC-bound and must decode as HEVC before H.264 delivery", async () => {
  let observed;
  const input = verificationInput({
    structural: { ...STRUCTURAL, sourceCodec: "hevc" },
    fetchImpl: async (url, request) => {
      observed = verifyVideoVerifierRequest({
        secret: SECRET,
        path: new URL(url).pathname,
        body: request.body,
        headers: request.headers,
      }).payload;
      return signedResponse({ path: new URL(url).pathname, request, payload: decodedPayload });
    },
  });
  const result = await verifyVideoObject(input);
  assert.equal(observed.object.contentType, "video/mp4");
  assert.equal(observed.object.key.endsWith(".mp4"), true);
  assert.equal(observed.structural.sourceCodec, "hevc");
  assert.equal(Object.hasOwn(observed.structural, "sourceContainer"), false);
  assert.equal(observed.output.contentType, "video/mp4");
  assert.equal(result.delivery.contentType, "video/mp4");

  await assert.rejects(() => verifyVideoObject(verificationInput({
    structural: { ...STRUCTURAL, sourceCodec: "hevc" },
    fetchImpl: (url, request) => signedResponse({
      path: new URL(url).pathname,
      request,
      payload: (requestPayload) => {
        const decoded = decodedPayload(requestPayload);
        decoded.video.codec = "h264";
        return decoded;
      },
    }),
  })), (error) => error.status === 503 && error.code === "MEDIA_STORAGE_UNAVAILABLE");

  for (const overrides of [
    { objectKey: "users/u_video/post/type-confusion.mov" },
    { structural: { ...STRUCTURAL, sourceContainer: "quicktime", sourceCodec: "hevc" } },
    { structural: { ...STRUCTURAL, sourceCodec: "h264" } },
  ]) {
    await assert.rejects(() => verifyVideoObject(verificationInput({
      ...overrides,
      fetchImpl: async () => { throw new Error("must not call verifier"); },
    })), (error) => error.status === 500 && error.code === "INTERNAL_ERROR");
  }
});

test("authenticated worker busy rolls back the scarce permit and preserves fresh health", async () => {
  const at = Date.now();
  await refreshVideoVerifierHealth({
    env: ENV,
    at,
    fetchImpl: (url, request) => signedResponse({
      path: new URL(url).pathname,
      request,
      payload: healthyPayload(),
    }),
  });
  let commits = 0;
  let rollbacks = 0;
  await assert.rejects(() => verifyVideoObject(verificationInput({
    beforeStart: () => ({
      commit() { commits += 1; },
      rollback() { rollbacks += 1; },
    }),
    fetchImpl: (url, request) => signedResponse({
      path: new URL(url).pathname,
      request,
      status: 429,
      payload: { ok: false, code: "busy" },
    }),
  })), (error) => error.status === 429 && error.code === "RATE_LIMITED");
  assert.deepEqual({ commits, rollbacks }, { commits: 0, rollbacks: 1 });
  assert.equal(videoVerifierRuntimeStatus(ENV, at + 1).ready, true);
  const busyHealth = await refreshVideoVerifierHealth({
    env: ENV,
    at: at + 2,
    fetchImpl: (url, request) => signedResponse({
      path: new URL(url).pathname,
      request,
      status: 429,
      payload: { ok: false, code: "busy" },
    }),
  });
  assert.equal(busyHealth.ready, true);
  assert.equal(busyHealth.lastAttemptAt, at, "capacity does not overwrite the latest proven health attempt");
});

test("authenticated source/decode conflict stays 409 and consumes an admitted job once", async () => {
  let commits = 0;
  let rollbacks = 0;
  await assert.rejects(() => verifyVideoObject(verificationInput({
    beforeStart: () => ({
      commit() { commits += 1; },
      rollback() { rollbacks += 1; },
    }),
    fetchImpl: (url, request) => signedResponse({
      path: new URL(url).pathname,
      request,
      status: 409,
      payload: { ok: false, code: "metadata_mismatch" },
    }),
  })), (error) => error.status === 409 && error.code === "CONFLICT");
  assert.deepEqual({ commits, rollbacks }, { commits: 1, rollbacks: 0 });
});

test("signed worker 422 codes distinguish source rejection from retryable pipeline failures", async (context) => {
  const privateWorkerMessage = "private worker diagnostic must not cross the boundary";
  const cases = [
    { code: "unsupported_media", status: 415, apiCode: "MEDIA_TYPE_UNSUPPORTED" },
    { code: "decode_failed", status: 503, apiCode: "MEDIA_STORAGE_UNAVAILABLE" },
    { code: "invalid_request", status: 503, apiCode: "MEDIA_STORAGE_UNAVAILABLE" },
    { code: "incompatible_protocol", status: 503, apiCode: "MEDIA_STORAGE_UNAVAILABLE" },
    { code: "delivery_invalid", status: 503, apiCode: "MEDIA_STORAGE_UNAVAILABLE" },
    { code: "poster_invalid", status: 503, apiCode: "MEDIA_STORAGE_UNAVAILABLE" },
    { code: "verification_failed", status: 503, apiCode: "MEDIA_STORAGE_UNAVAILABLE" },
    { code: "unknown_worker_failure", status: 503, apiCode: "MEDIA_STORAGE_UNAVAILABLE" },
  ];

  for (const fixture of cases) {
    await context.test(fixture.code, async () => {
      await assert.rejects(() => verifyVideoObject(verificationInput({
        fetchImpl: (url, request) => signedResponse({
          path: new URL(url).pathname,
          request,
          status: 422,
          payload: { ok: false, code: fixture.code, message: privateWorkerMessage },
        }),
      })), (error) => {
        assert.equal(error.status, fixture.status);
        assert.equal(error.code, fixture.apiCode);
        assert.equal(error.message.includes(privateWorkerMessage), false);
        if (fixture.status === 503) assert.match(error.message, /Try again later/u);
        return true;
      });
    });
  }
});

test("an unsigned 422 source claim cannot select the non-retryable media error", async () => {
  await assert.rejects(() => verifyVideoObject(verificationInput({
    fetchImpl: async () => new Response(JSON.stringify({
      ok: false,
      code: "unsupported_media",
    }), {
      status: 422,
      headers: { "content-type": "application/json" },
    }),
  })), (error) => error.status === 503 && error.code === "MEDIA_STORAGE_UNAVAILABLE");
});

test("one coalesced caller abort does not cancel an independently live waiter", async () => {
  const gate = deferred();
  const leaderAbort = new AbortController();
  const followerAbort = new AbortController();
  let jobSignal;
  let fetches = 0;
  const fetchImpl = async (url, request) => {
    fetches += 1;
    jobSignal = request.signal;
    await gate.promise;
    if (request.signal.aborted) throw request.signal.reason;
    return signedResponse({ path: new URL(url).pathname, request, payload: decodedPayload });
  };
  const leader = verifyVideoObject(verificationInput({ fetchImpl, signal: leaderAbort.signal }));
  const follower = verifyVideoObject(verificationInput({ fetchImpl, signal: followerAbort.signal }));
  leaderAbort.abort(new DOMException("leader left", "AbortError"));
  await assert.rejects(() => leader, { name: "AbortError" });
  assert.equal(jobSignal.aborted, false);
  gate.resolve();
  assert.equal((await follower).poster.timeMs, 2_000);
  assert.equal(fetches, 1);
});

test("pre-abort and abort during health wait start no reservation or verifier job", async () => {
  let starts = 0;
  let verifyFetches = 0;
  const alreadyAborted = new AbortController();
  alreadyAborted.abort(new DOMException("gone", "AbortError"));
  await assert.rejects(() => verifyVideoObject(verificationInput({
    signal: alreadyAborted.signal,
    beforeStart: () => { starts += 1; },
    fetchImpl: async () => { verifyFetches += 1; },
  })), { name: "AbortError" });

  const healthGate = deferred();
  startVideoVerifierHealthScheduler({
    env: ENV,
    fetchImpl: async (url, request) => {
      await healthGate.promise;
      return signedResponse({ path: new URL(url).pathname, request, payload: healthyPayload() });
    },
  });
  const caller = new AbortController();
  const waiting = verifyVideoObject(verificationInput({
    signal: caller.signal,
    beforeStart: () => { starts += 1; },
    fetchImpl: async () => { verifyFetches += 1; },
  }));
  caller.abort(new DOMException("left during health", "AbortError"));
  await assert.rejects(() => waiting, { name: "AbortError" });
  assert.deepEqual({ starts, verifyFetches }, { starts: 0, verifyFetches: 0 });
  healthGate.resolve();
});
