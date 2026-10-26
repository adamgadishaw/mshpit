import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pit-deezer-shared-cooldown-"));
process.env.PIT_DATA_DIR = directory;
const originalFetch = globalThis.fetch;
const realNow = Date.now;
globalThis.fetch = async () => assert.fail("unexpected live provider call");
const { db } = await import("./db.js");
const { routes } = await import("./api.js");
const { providerJson, findDeezerArtistCandidates } = await import("./musicProviders.js");
after(() => { Date.now = realNow; globalThis.fetch = originalFetch; db.close(); rmSync(directory, { recursive: true, force: true }); });
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers });
const context = name => ({ query: { name }, ip: "shared-deezer-fixture" });

test("one provider refusal stops distinct resolver names, candidates, playback and custom transports until recovery", async () => {
  let now = realNow(), mb = 0, deezer = 0;
  Date.now = () => now;
  globalThis.fetch = async url => {
    if (new URL(url).hostname === "musicbrainz.org") { mb++; return json({}, 503, { "Retry-After": "120" }); }
    assert.equal(new URL(url).hostname, "api.deezer.com"); deezer++; return json({}, 429, { "Retry-After": "120" });
  };
  const unavailable = error => error.code === "PROVIDER_UNAVAILABLE";
  await assert.rejects(routes["GET /api/artists/resolve"](context("Shared Wait A")), unavailable);
  for (const name of ["Shared Wait B", "Shared Wait A"]) await assert.rejects(routes["GET /api/artists/resolve"](context(name)), unavailable);
  await assert.rejects(routes["GET /api/artists/candidates"](context("Shared Wait A")), error => unavailable(error) && error.cause.code === "circuit_open");
  const track = await routes["GET /api/deezer/track"]({ query: { title: "Shared Wait Song", artist: "Shared Wait C" }, ip: "shared-deezer-fixture" });
  assert.equal(track.preview, null); assert.equal(track.status, "circuit_open");
  await assert.rejects(providerJson("Deezer", "https://api.deezer.com/album/1", {
    fetchImpl: () => assert.fail("a different injected transport must share the provider wait"),
  }), { code: "circuit_open" });
  assert.equal(mb, 1); assert.equal(deezer, 1);
  now += 60_000;
  await assert.rejects(findDeezerArtistCandidates("Shared Wait D"), error => error.retryAfterMs === 60_000);
  now += 60_000;
  let release;
  const probe = providerJson("Deezer", "https://api.deezer.com/search/artist?q=probe", {
    fetchImpl: async () => { deezer++; return new Promise(resolve => { release = resolve; }); },
  });
  const concurrent = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => findDeezerArtistCandidates("Probe Wait " + i)));
  assert.ok(concurrent.every(result => result.status === "rejected" && result.reason.code === "circuit_open"));
  release(json({ data: [] })); assert.deepEqual(await probe, { data: [] });
  assert.equal(deezer, 2);
  // A 503 hint from a different endpoint starts the same shared wait.
  await assert.rejects(providerJson("Deezer", "https://api.deezer.com/album/2", {
    fetchImpl: async () => { deezer++; return json({}, 503, { "Retry-After": "120" }); },
  }), error => error.status === 503 && error.retryAfterMs === 120_000);
  await assert.rejects(findDeezerArtistCandidates("Shared Wait E"), { code: "circuit_open" });
  assert.equal(deezer, 3);
});
