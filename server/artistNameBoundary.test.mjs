import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchResolvedArtist, attachArtistSuggestion } from "../src/features/artistSearch/artistSearchApi.mjs";

const directory = mkdtempSync(join(tmpdir(), "pit-complete-artist-name-"));
process.env.PIT_DATA_DIR = directory;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => assert.fail("identity boundary fixture permits no provider calls");
const { db, artistStmts, artistRow } = await import("./db.js");
const { routes } = await import("./api.js");
after(() => { globalThis.fetch = originalFetch; db.close(); rmSync(directory, { recursive: true, force: true }); });
const context = name => ({ query: { name, scope: "stored" }, ip: "complete-name-fixture" });
const mbid = "44444444-5555-4666-8777-888888888888";

test("overlength and malformed direct inputs reject before reading a prefix identity", async t => {
  const name = "Q".repeat(120);
  artistStmts.upsert.run(artistRow(name, { name, mbid }, "fixture"));
  const read = t.mock.method(artistStmts.byNorm, "get", () => assert.fail("invalid name must not read catalogue"));
  try {
    for (const invalid of [name + "suffix", "🎵".repeat(121), "A\ud800", "\udfff", {}, [name]]) {
      for (const route of ["GET /api/artists/resolve", "GET /api/artists/candidates"]) {
        await assert.rejects(routes[route](context(invalid)), { status: 400, code: "VALIDATION_FAILED" });
      }
      assert.equal(await fetchResolvedArtist(invalid, { apiClient: () => assert.fail("invalid client input") }), null);
      await assert.rejects(attachArtistSuggestion({ name: invalid }, { apiClient: () => assert.fail("invalid attachment") }), TypeError);
    }
  } finally { read.mock.restore(); }
  assert.equal((await routes["GET /api/artists/resolve"](context(name))).artist.mbid, mbid);
});

test("61 through 120 astral characters survive client, resolver and catalogue without prefix collisions", async () => {
  const prefix = "🎵".repeat(60);
  artistStmts.upsert.run(artistRow(prefix, { name: prefix, mbid }, "fixture"));
  const apiClient = (path, options) => {
    const url = new URL(path, "https://fixture.invalid");
    return routes["GET /api/artists/resolve"]({ ...context(url.searchParams.get("name")), signal: options.signal });
  };
  assert.equal(await fetchResolvedArtist(prefix + "🎵", { scope: "stored", apiClient }), null);
  for (const name of [prefix + "🎵", "A" + "🎵".repeat(119), "🎵".repeat(120)]) {
    artistStmts.upsert.run(artistRow(name, { name, mbid: "55555555-6666-4777-8888-999999999999" }, "fixture"));
    const result = await fetchResolvedArtist(name, { scope: "stored", apiClient });
    assert.equal(result.name, name);
    assert.notEqual(result.key, prefix);
    let sent;
    await attachArtistSuggestion({ name, mbid }, { apiClient: async (_path, options) => {
      sent = options.body.name; return { artist: { name, key: "stored" } };
    } });
    assert.equal(sent, name);
  }
});

test("provider fallback keeps the full exact Unicode name in its response and cache", async () => {
  const name = "🎸".repeat(61); let calls = 0;
  globalThis.fetch = async url => {
    calls++;
    return new Response(JSON.stringify(new URL(url).hostname === "musicbrainz.org"
      ? { artists: [] } : { data: [{ id: 454545, name }] }));
  };
  try {
    const first = await routes["GET /api/artists/resolve"]({ query: { name }, ip: "complete-name-fallback" });
    assert.equal(first.artist.name, name); assert.equal(first.providerFallback, "deezer");
    globalThis.fetch = async () => assert.fail("full exact fallback should be cached");
    const replay = await routes["GET /api/artists/resolve"]({ query: { name }, ip: "complete-name-fallback" });
    assert.equal(replay.artist.name, name); assert.equal(replay.cached, true); assert.equal(calls, 2);
  } finally { globalThis.fetch = async () => assert.fail("unexpected provider call"); }
});
