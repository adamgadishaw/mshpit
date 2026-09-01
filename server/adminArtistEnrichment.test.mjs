import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-admin-artist-enrichment-"));
process.env.PIT_DATA_DIR = dataDir;

const { artistRow, artistStmts, db, normName, q } = await import("./db.js");
const { routes } = await import("./api.js");
const { ProviderError } = await import("./musicProviders.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function addAdmin(id) {
  q.insertUser.run(
    id,
    `${id}@example.com`,
    id,
    id.replace(/[^a-z0-9_]/g, "").slice(0, 20),
    "test-hash",
    "admin",
    "Toronto",
    43.65,
    -79.38,
    "AE",
    "#123456",
    Date.now(),
  );
  return q.userById.get(id);
}

const unavailable = () => ({
  ok: false,
  status: 503,
  json: async () => ({ error: "temporarily unavailable" }),
});

test("admin enrichment returns verified cached artist data with a degraded provider status", async () => {
  const name = "Provider Cached Fallback Fixture";
  const key = normName(name);
  const mbid = "22222222-2222-4222-8222-222222222222";
  artistStmts.upsert.run(artistRow(key, {
    name,
    mbid,
    photo: "https://cdn.example.com/provider-cached-fallback.jpg",
    popularity: 73,
    topTracks: [{ id: 701, title: "Persisted Track" }],
  }, "musicbrainz"));
  const before = artistStmts.byNorm.get(key);
  const admin = addAdmin("enrichcachedadmin");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => unavailable();
  let result;
  try {
    result = await routes["POST /api/admin/artists/enrich"]({
      user: admin,
      body: { names: [name] },
      signal: new AbortController().signal,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(result.status, "degraded");
  assert.equal(result.degraded, true);
  assert.equal(result.enriched, 0);
  assert.equal(result.artists.length, 1);
  assert.equal(result.artists[0].mbid, mbid);
  assert.equal(result.artists[0].photo, before.photo);
  assert.deepEqual(result.providerFailures, [{
    artist: name,
    provider: "Deezer",
    code: "http_error",
    retryable: true,
  }]);
  const afterFailure = artistStmts.byNorm.get(key);
  assert.equal(afterFailure.data, before.data, "provider failure cannot synthesize or rewrite cached enrichment");
  assert.equal(afterFailure.updated_at, before.updated_at);
});

test("exact MusicBrainz identity survives optional Deezer failure and reports degradation", async () => {
  const name = "Exact Degraded Artist Fixture";
  const mbid = "33333333-3333-4333-8333-333333333333";
  const admin = addAdmin("enrichexactadmin");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("musicbrainz.org/ws/2/artist")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          artists: [{
            id: mbid,
            name,
            score: 100,
            area: { name: "Canada" },
            "life-span": { begin: "2020-01-01" },
          }],
        }),
      };
    }
    return unavailable();
  };
  let result;
  try {
    result = await routes["POST /api/admin/artists/enrich"]({
      user: admin,
      body: { names: [name], requireExactIdentity: true },
      signal: new AbortController().signal,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(result.status, "degraded");
  assert.equal(result.enriched, 0);
  assert.equal(result.artists.length, 1);
  assert.equal(result.artists[0].mbid, mbid);
  assert.equal(result.artists[0].deezerId, undefined);
  assert.deepEqual(result.providerFailures, [{
    artist: name,
    provider: "Deezer",
    code: "http_error",
    retryable: true,
  }]);
  const persisted = artistStmts.byNorm.get(normName(name));
  assert.equal(persisted.mbid, mbid);
  assert.equal(JSON.parse(persisted.data).deezerId, undefined,
    "an unavailable optional provider contributes no invented identity or enrichment");
});

test("an uncached provider failure remains an error instead of fabricating an artist", async () => {
  const name = "No Local Enrichment Fixture";
  const admin = addAdmin("enrichmissingadmin");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => unavailable();
  try {
    await assert.rejects(
      () => routes["POST /api/admin/artists/enrich"]({
        user: admin,
        body: { names: [name] },
        signal: new AbortController().signal,
      }),
      (error) => error instanceof ProviderError
        && error.provider === "Deezer"
        && error.status === 503
        && error.code === "http_error",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(artistStmts.byNorm.get(normName(name)), undefined);
});
