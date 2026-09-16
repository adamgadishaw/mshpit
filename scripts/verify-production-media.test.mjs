import assert from "node:assert/strict";
import test from "node:test";

import {
  PRODUCTION_MEDIA_HEALTH_MAX_BYTES,
  productionMediaHealthUrl,
  verifyProductionMedia,
} from "./verify-production-media.mjs";

function healthyPayload() {
  return {
    ok: true,
    mediaPublishingContract: {
      negotiationRequired: false,
      pipeline: "private-derivative-v1",
      state: "ready",
    },
    capabilities: {
      mediaPublishing: {
        photos: true,
        videos: true,
        pipeline: "private-derivative-v1",
        sourceTypes: ["video/mp4", "video/quicktime"],
        sourceCodecs: {
          "video/mp4": ["h264", "hevc"],
          "video/quicktime": ["h264", "hevc"],
        },
      },
    },
  };
}

function jsonResponse(payload, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("production media verifier requests and validates the exact versioned client contract", async () => {
  const calls = [];
  const result = await verifyProductionMedia({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse(healthyPayload());
    },
  });

  const expectedUrl = "https://www.mshpit.com/api/health?mediaPipeline=private-derivative-v1";
  assert.equal(productionMediaHealthUrl(), expectedUrl);
  assert.equal(calls[0].url, expectedUrl);
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.headers.accept, "application/json");
  assert.deepEqual(result, {
    ok: true,
    url: expectedUrl,
    pipeline: "private-derivative-v1",
    state: "ready",
    sourceTypes: ["video/mp4", "video/quicktime"],
  });
});

test("production media verifier rejects legacy, unavailable, and incomplete decoder contracts", async () => {
  const legacy = healthyPayload();
  legacy.mediaPublishingContract.negotiationRequired = true;
  legacy.capabilities.mediaPublishing = { photos: true, videos: false };
  await assert.rejects(
    verifyProductionMedia({ fetchImpl: async () => jsonResponse(legacy) }),
    /observability contract is not deployed or is incompatible/,
  );

  const unavailable = healthyPayload();
  unavailable.mediaPublishingContract.state = "unavailable";
  unavailable.capabilities.mediaPublishing.videos = false;
  await assert.rejects(
    verifyProductionMedia({ fetchImpl: async () => jsonResponse(unavailable) }),
    /not ready for the exact client pipeline/,
  );

  const missingIphoneCodec = healthyPayload();
  missingIphoneCodec.capabilities.mediaPublishing.sourceCodecs["video/quicktime"] = ["h264"];
  await assert.rejects(
    verifyProductionMedia({ fetchImpl: async () => jsonResponse(missingIphoneCodec) }),
    /not ready for the exact client pipeline/,
  );
});

test("production media verifier accepts only a plain HTTPS origin", () => {
  assert.throws(() => productionMediaHealthUrl("http://www.mshpit.com"), /plain HTTPS origin/);
  assert.throws(() => productionMediaHealthUrl("https://user:pass@www.mshpit.com"), /plain HTTPS origin/);
  assert.throws(() => productionMediaHealthUrl("https://www.mshpit.com/not-an-origin"), /plain HTTPS origin/);
});

test("expanded source readiness requires the exact advertised revision without breaking baseline checks", async () => {
  for (const revision of [undefined, null, "2", 0, -2, 1, 2.5, 3]) {
    const payload = healthyPayload();
    payload.capabilities.mediaPublishing.sourceAdmissionRevision = revision;
    const fetchImpl = async () => jsonResponse(payload);
    assert.equal((await verifyProductionMedia({ fetchImpl })).ok, true);
    await assert.rejects(verifyProductionMedia({ fetchImpl, requireSourceAdmissionRevision: 2 }),
      /source support revision 2 is not ready/);
  }
  const payload = healthyPayload();
  payload.capabilities.mediaPublishing.sourceAdmissionRevision = 2;
  const result = await verifyProductionMedia({
    fetchImpl: async () => jsonResponse(payload), requireSourceAdmissionRevision: 2,
  });
  assert.equal(result.sourceAdmissionRevision, 2);
});

test("invalid required source revisions fail before making a network request", async () => {
  let calls = 0;
  for (const revision of [null, "2", 0, -1, 1.5, 1001, NaN, Infinity]) {
    await assert.rejects(verifyProductionMedia({
      requireSourceAdmissionRevision: revision,
      fetchImpl: async () => { calls += 1; return jsonResponse(healthyPayload()); },
    }), /integer from 1 to 1000/);
  }
  assert.equal(calls, 0);
});

test("production media verifier fails closed on transport and response-shape errors", async () => {
  await assert.rejects(
    verifyProductionMedia({ fetchImpl: async () => jsonResponse(healthyPayload(), { status: 503 }) }),
    /HTTP 503/,
  );
  await assert.rejects(
    verifyProductionMedia({
      fetchImpl: async () => new Response("not-json", { status: 200, headers: { "content-type": "text/plain" } }),
    }),
    /did not return JSON/,
  );
  await assert.rejects(
    verifyProductionMedia({
      fetchImpl: async () => new Response("{", { status: 200, headers: { "content-type": "application/json" } }),
    }),
    /invalid JSON/,
  );
  await assert.rejects(
    verifyProductionMedia({
      fetchImpl: async () => new Response("x".repeat(PRODUCTION_MEDIA_HEALTH_MAX_BYTES + 1), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    }),
    /too large/,
  );
  await assert.rejects(
    verifyProductionMedia({ fetchImpl: async () => { throw new Error("private details"); } }),
    /could not be reached/,
  );
});
