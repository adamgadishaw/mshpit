import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_PRODUCTION_JSON_BYTES,
  verifyProductionCore,
} from "./verify-production-core.mjs";

function payloadFor(path) {
  if (path === "/api/health") return { ok: true };
  if (path === "/api/readiness") return { ok: true, ts: Date.now() };
  if (path === "/api/time") return { now: Date.now(), iso: new Date().toISOString() };
  if (path.startsWith("/api/artists")) return { artists: [{ name: "Drake" }], total: 1 };
  if (path === "/api/discover/overview?by=popularity&country=Worldwide") {
    return {
      catalogTotal: 1_000,
      chart: { rows: [{ id: "artist_drake", name: "Drake" }] },
      topRatedShows: [],
    };
  }
  if (path.includes("days=30")) return { tourDates: [], range: { days: 30 } };
  if (path === "/api/tourdates") return { tourDates: [] };
  if (path === "/api/discovery/sidebar") return { upcomingEvents: [] };
  throw new Error(`unexpected path ${path}`);
}

function fakeFetch(overrides = {}) {
  return async (input) => {
    const path = new URL(input).pathname + new URL(input).search;
    const override = overrides[path];
    const value = override?.payload ?? payloadFor(path);
    const body = override?.body ?? JSON.stringify(value);
    return new Response(body, {
      status: override?.status ?? 200,
      headers: {
        "content-type": override?.contentType ?? "application/json",
        ...(path === "/api/tourdates" && !override?.omitContinuationHeaders
          ? { "x-pit-results-truncated": "false" } : {}),
        ...(override?.headers || {}),
      },
    });
  };
}

test("production core verifier proves bounded database-backed public functions", async () => {
  const report = await verifyProductionCore({
    origin: "https://example.test",
    fetchImpl: fakeFetch(),
  });
  assert.equal(report.ok, true);
  assert.equal(report.checks.length, 8);
});

test("production core verifier fails closed on strict readiness and oversized legacy catalogs", async () => {
  await assert.rejects(
    verifyProductionCore({
      origin: "https://example.test",
      fetchImpl: fakeFetch({ "/api/readiness": { status: 503, payload: { ok: false } } }),
    }),
    /readiness.*HTTP 503/,
  );
  await assert.rejects(
    verifyProductionCore({
      origin: "https://example.test",
      fetchImpl: fakeFetch({
        "/api/tourdates": {
          payload: { tourDates: Array.from({ length: 501 }, (_, id) => ({ id })) },
        },
      }),
    }),
    /compatibility response is unbounded/,
  );
});

test("production core verifier requires a coherent legacy tour-date continuation contract", async () => {
  await assert.rejects(
    verifyProductionCore({
      origin: "https://example.test",
      fetchImpl: fakeFetch({
        "/api/tourdates": { omitContinuationHeaders: true },
      }),
    }),
    /continuation headers are invalid/,
  );
  await assert.rejects(
    verifyProductionCore({
      origin: "https://example.test",
      fetchImpl: fakeFetch({
        "/api/tourdates": {
          headers: { "x-pit-results-truncated": "true" },
        },
      }),
    }),
    /continuation headers are invalid/,
  );
  const report = await verifyProductionCore({
    origin: "https://example.test",
    fetchImpl: fakeFetch({
      "/api/tourdates": {
        headers: {
          "x-pit-results-truncated": "true",
          link: '</api/tourdates?scope=all-upcoming&limit=500&after=cursor>; rel="next"',
        },
      },
    }),
  });
  assert.equal(report.ok, true);
});

test("production core verifier catches missing catalog search data and catalog wipes", async () => {
  await assert.rejects(
    verifyProductionCore({
      origin: "https://example.test",
      fetchImpl: fakeFetch({
        "/api/artists?q=drake&limit=3": {
          payload: { artists: [{ name: "Not Drake" }], total: 1 },
        },
      }),
    }),
    /artist search projection is invalid/,
  );
  await assert.rejects(
    verifyProductionCore({
      origin: "https://example.test",
      fetchImpl: fakeFetch({
        "/api/discover/overview?by=popularity&country=Worldwide": {
          payload: {
            catalogTotal: 999,
            chart: { rows: [] },
            topRatedShows: [],
          },
        },
      }),
    }),
    /discover overview catalog is incomplete/,
  );
});

test("production core verifier bounds bytes and rejects unsafe target origins", async () => {
  await assert.rejects(
    verifyProductionCore({
      origin: "https://example.test",
      fetchImpl: fakeFetch({
        "/api/health": {
          headers: { "content-length": String(MAX_PRODUCTION_JSON_BYTES + 1) },
        },
      }),
    }),
    /\/api\/health response exceeds the production payload budget/,
  );
  await assert.rejects(
    verifyProductionCore({ origin: "http://www.mshpit.com", fetchImpl: fakeFetch() }),
    /plain HTTPS origin/,
  );
});
