import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import test, { after } from "node:test";
import { resolveNavigationArtist } from "../src/features/publicNavigation/publicNavigationApi.mjs";
import { resolvePublicFrameIdentity } from "../src/domain/publicFrameIdentity.mjs";

const directory = mkdtempSync(join(tmpdir(), "pit-artist-navigation-"));
process.env.PIT_DATA_DIR = directory;
const originalFetch = globalThis.fetch;
let providerCalls = 0;
globalThis.fetch = async () => { providerCalls++; throw new Error("Provider requests are forbidden in navigation fixtures"); };
const { db, artistStmts, artistRow, providerCacheStmts } = await import("./db.js");
const { routes } = await import("./api.js");
const { createArtistFallbackCache } = await import("./artistFallbackCache.js");
after(() => {
  globalThis.fetch = originalFetch;
  db.close();
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
  rmSync(directory, { recursive: true, force: true });
});
const saved = "Navigation Saved Fixture", mbid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
artistStmts.upsert.run(artistRow(saved, { name: saved, mbid }, "fixture"));
const context = (name, scope = "stored") => ({ query: { name, ...(scope === null ? {} : { scope }) }, ip: "navigation-fixture" });
const lookup = (name, scope) => routes["GET /api/artists/resolve"](context(name, scope));
const apiCall = (path, options) => {
  const url = new URL(path, "http://fixture.invalid");
  assert.equal(url.pathname, "/api/artists/resolve");
  assert.equal(url.searchParams.get("scope"), "stored");
  return routes["GET /api/artists/resolve"]({ ...context(url.searchParams.get("name")), signal: options.signal });
};

for (const code of ["network", "provider_timeout"]) test(`event-to-artist navigation and missing pages bypass ${code} provider failures`, async () => {
  providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls++;
    throw Object.assign(new Error("Provider fixture unavailable"), { code, status: 504, retryable: true });
  };
  const before = artistStmts.count.get().c;
  db.exec("PRAGMA query_only=ON");
  try {
    const frame = await resolvePublicFrameIdentity({ artistName: saved }, {
      resolveArtist: (name, options) => resolveNavigationArtist(name, options, { apiCall }),
    });
    assert.equal(frame.frame.artistName, saved);
    assert.equal(frame.path, "/artist/navigation-saved-fixture");
    const missing = await resolvePublicFrameIdentity({ artistName: "Navigation Missing Fixture" }, {
      resolveArtist: (name, options) => resolveNavigationArtist(name, options, { apiCall }),
    });
    assert.equal(missing, null, "confirmed missing durable page does not invent a route");
    assert.equal(artistStmts.count.get().c, before);
    assert.equal(providerCalls, 0);
  } finally { db.exec("PRAGMA query_only=OFF"); }
});

test("stored names, canonical slugs and reviewed aliases preserve exact durable identity", async () => {
  providerCalls = 0;
  const byName = await lookup(saved);
  const bySlug = await lookup(byName.artist.publicSlug);
  assert.equal(byName.artist.mbid, mbid);
  assert.equal(bySlug.artist.key, byName.artist.key);
  assert.equal(byName.transient, undefined);
  const alias = await lookup("ASAP Rocky");
  assert.equal(alias.artist.key, "a$ap rocky");
  assert.equal(alias.artist.mbid, "25b7b584-d952-4662-a8b9-dd8cdfbfeb64");
  assert.equal(providerCalls, 0);
});

test("provider caches remain preview-only while newly stored identities take precedence", async () => {
  const cachedName = "Navigation Cached Fixture", fallbackName = "Navigation Deezer Fixture";
  providerCacheStmts.set.run("mbresolve:v1:navigation cached fixture", JSON.stringify({ name: cachedName, mbid }), 1, 2);
  assert.equal(createArtistFallbackCache(db).remember(fallbackName, { name: fallbackName, deezerId: "4242" }), true);
  for (const name of [cachedName, fallbackName]) {
    assert.deepEqual(await lookup(name), { artist: null, created: false });
    const discovery = await lookup(name, null);
    assert.equal(discovery.cached, true);
    assert.equal(discovery.transient, true, "discovery keeps its cached preview");
  }
  artistStmts.upsert.run(artistRow(cachedName, { name: cachedName, mbid: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff" }, "fixture"));
  const durable = await lookup(cachedName);
  assert.equal(durable.artist.mbid, "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff");
  assert.equal(durable.transient, undefined);
});

test("a hidden member-created identity is not exposed or replaced by a provider preview", async () => {
  const name = "Navigation Hidden Fixture";
  artistStmts.upsert.run(artistRow(name, { name, mbid }, "artist-created"));
  const before = providerCalls;
  assert.deepEqual(await lookup(name), { artist: null, created: false });
  assert.deepEqual(await lookup(name, null), { artist: null, created: false });
  assert.equal(providerCalls, before);
});

test("invalid scopes cannot silently enable provider discovery", async () => {
  const before = providerCalls;
  await assert.rejects(lookup("Navigation Unknown Fixture", "typo"), error => error.status === 400 && error.code === "VALIDATION_FAILED");
  assert.equal(providerCalls, before);
});

test("a failed catalogue read remains unavailable rather than a confirmed missing page", async (t) => {
  const failure = Object.assign(new Error("Catalogue fixture unavailable"), { code: "SQLITE_BUSY" });
  const before = providerCalls;
  const read = t.mock.method(artistStmts.byNorm, "get", () => { throw failure; });
  try {
    await assert.rejects(lookup(saved), error => error === failure);
    assert.equal(providerCalls, before);
  } finally { read.mock.restore(); }
  assert.equal((await lookup(saved)).artist.mbid, mbid, "a subsequent read may recover normally");
});

test("ordinary discovery still resolves a remote preview without creating a durable artist", async () => {
  const name = "Navigation Discovery Fixture";
  providerCalls = 0;
  globalThis.fetch = async (url) => {
    providerCalls++;
    assert.equal(new URL(url).hostname, "musicbrainz.org");
    return new Response(JSON.stringify({ artists: [{ name, id: mbid, score: 100 }] }));
  };
  const result = await lookup(name, null);
  assert.equal(result.artist.name, name);
  assert.equal(result.transient, true);
  assert.equal(result.created, false);
  assert.equal(artistStmts.byNorm.get(name.toLowerCase()), undefined);
  assert.equal(providerCalls, 1);
});
