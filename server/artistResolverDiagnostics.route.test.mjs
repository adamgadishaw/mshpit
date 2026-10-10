import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { ARTIST_FALLBACK_CACHE_TTL_MS } from "./artistFallbackCache.js";

const directory = mkdtempSync(join(tmpdir(), "pit-resolver-diagnostics-"));
process.env.PIT_DATA_DIR = directory;
const originalFetch = globalThis.fetch;
const blockedFetch = async () => assert.fail("Only explicit mocked provider calls are permitted");
globalThis.fetch = blockedFetch;
const { db, artistStmts, artistRow, providerCacheStmts } = await import("./db.js");
const { routes } = await import("./api.js");
const { artistResolverMetrics } = await import("./artistResolverDiagnostics.js");
after(() => { globalThis.fetch = originalFetch; db.close(); rmSync(directory, { recursive: true, force: true }); });

const mbid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const json = (value) => new Response(JSON.stringify(value));
function lookup(name, { capture, ...extra } = {}) {
  return routes["GET /api/artists/resolve"]({ query: { name }, ip: "private-request-address", artistResolverEntryPoint: "event_page",
    captureArtistResolverDiagnostics: capture, ...extra });
}
function assertPrivate(detail, name) {
  const serialized = JSON.stringify(detail);
  assert.ok(!serialized.toLowerCase().includes(name.toLowerCase()));
  assert.doesNotMatch(serialized, /private-request-address|mbresolve:|dzresolve:|example\.test|aaaaaaaa-bbbb/);
}

test("catalog, visibility-filtered identity and each persisted cache have distinct read-only sources", async () => {
  const entries = [
    ["Diagnostic Stored Artist", "catalog"], ["Diagnostic Hidden Artist", "catalog_hidden"],
    ["Diagnostic Fresh Artist", "musicbrainz_cache_fresh"], ["Diagnostic Stale Artist", "musicbrainz_cache_stale"],
    ["Diagnostic Fallback Artist", "deezer_cache"],
  ];
  artistStmts.upsert.run(artistRow(entries[0][0], { name: entries[0][0], mbid }, "fixture"));
  artistStmts.upsert.run(artistRow(entries[1][0], { name: entries[1][0], mbid }, "artist-created"));
  const at = Date.now();
  providerCacheStmts.set.run("mbresolve:v1:diagnostic fresh artist", JSON.stringify({ name: entries[2][0], mbid }), at, at + 60000);
  providerCacheStmts.set.run("mbresolve:v1:diagnostic stale artist", JSON.stringify({ name: entries[3][0], mbid }), 1, 2);
  providerCacheStmts.set.run("dzresolve:v1:diagnostic fallback artist", JSON.stringify({ name: entries[4][0], deezerId: "876543" }), at, at + ARTIST_FALLBACK_CACHE_TTL_MS);
  const before = artistResolverMetrics.snapshot();
  db.exec("PRAGMA query_only=ON");
  try {
    for (const [name, source] of entries) {
      let detail, captures = 0;
      const result = await lookup(name, { capture: (value) => { detail = value; captures++; } });
      assert.equal(detail.source, source);
      assert.equal(detail.outcome, source === "catalog_hidden" ? "no_match" : "matched");
      assert.equal(detail.cacheWrite, "not_attempted");
      assert.equal(detail.musicbrainz.outcome, "not_started");
      assert.equal(detail.deezer.outcome, "not_started");
      assert.equal(captures, 1);
      assert.equal(result.created, false);
      if (source === "catalog_hidden") assert.deepEqual(result, { artist: null, created: false });
      else assert.equal(result.artist.name, name);
      assert.equal(Object.hasOwn(result, "diagnostics"), false);
      assertPrivate(detail, name);
    }
  } finally { db.exec("PRAGMA query_only=OFF"); }
  const after = artistResolverMetrics.snapshot();
  assert.equal(after.completed - before.completed, 5);
  assert.equal(after.storedMatches - before.storedMatches, 4, "hidden identities never inflate protected artist matches");
});

test("primary miss plus fallback deadline reports both outcomes and preserves unavailable on memoized replay", async () => {
  const name = "Diagnostic Deadline Artist";
  let calls = 0, firstDetail, secondDetail, firstError;
  globalThis.fetch = async (url, options) => {
    calls++;
    const host = new URL(url).hostname;
    if (host === "musicbrainz.org") return json({ artists: [] });
    assert.equal(host, "api.deezer.com");
    return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
  };
  try {
    await assert.rejects(lookup(name, { capture: (value) => { firstDetail = value; } }), (error) => {
      firstError = error;
      return error.status === 502 && error.code === "PROVIDER_UNAVAILABLE" && error.cause.code === "provider_timeout";
    });
    await assert.rejects(lookup(name, { capture: (value) => { secondDetail = value; } }),
      (error) => error.status === 502 && error.cause === firstError.cause);
    assert.equal(calls, 2, "replay creates no new upstream work");
    assert.equal(firstDetail.musicbrainz.outcome, "no_match");
    assert.equal(firstDetail.musicbrainz.origin, "new_work");
    assert.equal(firstDetail.deezer.outcome, "unavailable");
    assert.equal(firstDetail.deezer.failure, "provider_timeout");
    assert.equal(firstDetail.deezer.origin, "new_work");
    assert.ok(firstDetail.deezer.elapsedMs >= 1400);
    assert.equal(secondDetail.musicbrainz.origin, "memoized_result");
    assert.equal(secondDetail.deezer.origin, "memoized_error");
    assert.equal(secondDetail.outcome, "unavailable");
    assert.equal(secondDetail.cacheWrite, "not_attempted");
    assertPrivate(firstDetail, name); assertPrivate(secondDetail, name);
  } finally { globalThis.fetch = blockedFetch; }
});

test("successful exact MusicBrainz result records optional storage failure without changing the result", async () => {
  const name = "Diagnostic Readonly Artist";
  let detail;
  globalThis.fetch = async (url) => {
    assert.equal(new URL(url).hostname, "musicbrainz.org");
    return json({ artists: [{ name, id: mbid, score: 100 }] });
  };
  db.exec("PRAGMA query_only=ON");
  try {
    const result = await lookup(name, { capture: (value) => { detail = value; } });
    assert.equal(result.artist.mbid, mbid);
    assert.equal(result.transient, true);
    assert.equal(detail.source, "musicbrainz");
    assert.equal(detail.cacheWrite, "optional_storage_failure");
    assert.equal(detail.outcome, "matched");
    assert.equal(detail.musicbrainz.outcome, "matched");
    assert.equal(detail.deezer.outcome, "not_started");
    assert.equal(providerCacheStmts.get.get("mbresolve:v1:diagnostic readonly artist"), undefined);
  } finally { db.exec("PRAGMA query_only=OFF"); globalThis.fetch = blockedFetch; }
  const replay = await lookup(name, { capture: (value) => { detail = value; } });
  assert.equal(replay.artist.mbid, mbid);
  assert.equal(detail.musicbrainz.origin, "memoized_result");
  assert.equal(detail.cacheWrite, "stored");
  assert.ok(providerCacheStmts.get.get("mbresolve:v1:diagnostic readonly artist"));
});

test("a fuzzy MusicBrainz preview remains ineligible for persistent identity recovery", async () => {
  const name = "Diagnostic Fuzzy Requested", selected = "Diagnostic Different Artist";
  let detail;
  globalThis.fetch = async (url) => {
    assert.equal(new URL(url).hostname, "musicbrainz.org");
    return json({ artists: [{ name: selected, id: mbid, score: 60 }] });
  };
  try {
    const result = await lookup(name, { capture: (value) => { detail = value; } });
    assert.equal(result.artist.name, selected);
    assert.equal(detail.cacheWrite, "not_eligible");
    assert.equal(detail.outcome, "matched");
    assert.equal(providerCacheStmts.get.get("mbresolve:v1:diagnostic fuzzy requested"), undefined);
    assertPrivate(detail, name); assertPrivate(detail, selected);
  } finally { globalThis.fetch = blockedFetch; }
});

test("exact fallback write success and optional write rejection remain distinct from lookup failure", async () => {
  const name = "Diagnostic Fresh Fallback";
  let detail;
  globalThis.fetch = async (url) => {
    const host = new URL(url).hostname;
    assert.ok(["musicbrainz.org", "api.deezer.com"].includes(host));
    return json(host === "musicbrainz.org" ? { artists: [] } : { data: [{ id: 8675309, name }] });
  };
  db.exec("PRAGMA query_only=ON");
  try {
    const result = await lookup(name, { capture: (value) => { detail = value; } });
    assert.equal(result.providerFallback, "deezer");
    assert.equal(detail.source, "deezer");
    assert.equal(detail.cacheWrite, "not_written");
    assert.equal(detail.outcome, "matched");
    assert.equal(detail.musicbrainz.outcome, "no_match");
    assert.equal(detail.deezer.outcome, "matched");
  } finally { db.exec("PRAGMA query_only=OFF"); globalThis.fetch = blockedFetch; }
  const result = await lookup(name, { capture: (value) => { detail = value; } });
  assert.equal(result.artist.deezerId, "8675309");
  assert.equal(detail.deezer.origin, "memoized_result");
  assert.equal(detail.cacheWrite, "stored");
  assert.ok(providerCacheStmts.get.get("dzresolve:v1:diagnostic fresh fallback"));
});

test("throwing capture does not affect saved results and metrics are absent from public health", async () => {
  const result = await lookup("Diagnostic Stored Artist", { capture: () => { throw new Error("private telemetry failure"); } });
  assert.equal(result.artist.mbid, mbid);
  const publicHealth = routes["GET /api/health"]({ query: {}, setHeader() {} });
  assert.equal(Object.hasOwn(publicHealth, "artistResolver"), false);
  assert.equal(Object.hasOwn(publicHealth, "services"), false);
  assert.throws(() => routes["GET /api/admin/health"]({}), (error) => error.status === 401);
  const staff = routes["GET /api/admin/health"]({ user: { id: "diagnostic-staff", role: "admin", verified: 1 } });
  assert.equal(staff.services.artistResolver.scope, "process_local_handler_completions");
  assert.ok(staff.services.artistResolver.completed >= 5);
  assert.doesNotMatch(JSON.stringify(staff.services.artistResolver), /Diagnostic Stored Artist|diagnostic-staff|private-request-address/);
});
