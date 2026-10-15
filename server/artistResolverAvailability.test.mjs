import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const directory = mkdtempSync(join(tmpdir(), "pit-artist-resolver-availability-"));
process.env.PIT_DATA_DIR = directory;
const originalFetch = globalThis.fetch;
const blockedFetch = async () => assert.fail("This fixture permits only explicitly mocked provider requests");
globalThis.fetch = blockedFetch;
const { db, artistStmts, artistRow, providerCacheStmts } = await import("./db.js");
const { routes } = await import("./api.js");
after(() => { globalThis.fetch = originalFetch; db.close(); rmSync(directory, { recursive: true, force: true }); });

const context = (name) => ({ query: { name }, ip: "artist-resolver-availability" });
const lookup = (name) => routes["GET /api/artists/resolve"](context(name));
const json = (payload, status = 200, headers = {}) => new Response(JSON.stringify(payload), { status, headers });
const unavailable = (error) => error.code === "PROVIDER_UNAVAILABLE" && error.status === 502;

test("a MusicBrainz miss plus unavailable Deezer remains unavailable on replay with a declining retry delay", async () => {
  let calls = 0;
  const realNow = Date.now;
  globalThis.fetch = async (url) => {
    calls++;
    if (new URL(url).hostname === "musicbrainz.org") return json({ artists: [] });
    assert.equal(new URL(url).hostname, "api.deezer.com");
    return json({}, 503, { "Retry-After": "7200" });
  };
  try {
    let first;
    await assert.rejects(lookup("Availability Retry Fixture"), (error) => {
      first = error;
      return unavailable(error) && error.cause.provider === "Deezer" && error.retryAfterMs > 7_000_000;
    });
    Date.now = () => realNow() + 60_000;
    await assert.rejects(lookup("Availability Retry Fixture"), (error) => unavailable(error)
      && error.retryAt === first.retryAt && error.retryAfterMs <= first.retryAfterMs - 60_000);
    assert.equal(calls, 2, "replaying the failure does not repeat either provider request");
    assert.equal(artistStmts.byNorm.get("availability retry fixture"), undefined);
  } finally { Date.now = realNow; globalThis.fetch = blockedFetch; }
});

test("two valid empty directories remain a genuine no-match", async () => {
  globalThis.fetch = async (url) => {
    const host = new URL(url).hostname;
    assert.ok(["musicbrainz.org", "api.deezer.com"].includes(host));
    return json(host === "musicbrainz.org" ? { artists: [] } : { data: [] });
  };
  try { assert.deepEqual(await lookup("Availability Empty Fixture"), { artist: null, created: false }); }
  finally { globalThis.fetch = blockedFetch; }
});

test("a MusicBrainz miss plus a malformed nonempty Deezer directory is unavailable", async () => {
  globalThis.fetch = async (url) => {
    const host = new URL(url).hostname;
    assert.ok(["musicbrainz.org", "api.deezer.com"].includes(host));
    return json(host === "musicbrainz.org" ? { artists: [] } : { data: [{ id: null, name: "Invalid" }] });
  };
  try {
    await assert.rejects(lookup("Availability Malformed Fixture"),
      (error) => unavailable(error) && error.cause.code === "invalid_payload");
  } finally { globalThis.fetch = blockedFetch; }
});

test("candidate directory preserves provider failure and caller cancellation", async () => {
  globalThis.fetch = async (url) => { assert.equal(new URL(url).hostname, "api.deezer.com"); return json({}, 503); };
  try {
    await assert.rejects(routes["GET /api/artists/candidates"](context("Availability Candidates Fixture")), unavailable);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(routes["GET /api/artists/candidates"]({ ...context("Availability Cancelled Fixture"), signal: controller.signal }),
      { name: "AbortError" });
  } finally { globalThis.fetch = blockedFetch; }
});

test("stored catalog and stale exact MusicBrainz identities remain immediately available without a provider", async () => {
  const mbid = "ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb";
  artistStmts.upsert.run(artistRow("availability stored fixture", { name: "Availability Stored Fixture", mbid }, "fixture"));
  providerCacheStmts.set.run("mbresolve:v1:availability stale fixture",
    JSON.stringify({ name: "Availability Stale Fixture", mbid }), 1, 2);
  db.exec("PRAGMA query_only=ON");
  try {
    const stored = await lookup("Availability Stored Fixture");
    assert.equal(stored.artist.mbid, mbid);
    assert.equal(stored.transient, undefined);
    const stale = await lookup("Availability Stale Fixture");
    assert.equal(stale.artist.mbid, mbid);
    assert.equal(stale.cached, true);
    assert.equal(stale.stale, true);
  } finally { db.exec("PRAGMA query_only=OFF"); }
});

test("a failed Deezer hedge cannot discard a later successful MusicBrainz identity", { timeout: 5_000 }, async () => {
  const name = "Availability Primary Wins Fixture";
  const mbid = "eeeeeeee-dddd-4ccc-8bbb-aaaaaaaaaaaa";
  let releasePrimary, fallbackCalls = 0;
  globalThis.fetch = async (url) => {
    if (new URL(url).hostname === "musicbrainz.org") {
      return new Promise((resolve) => { releasePrimary = resolve; });
    }
    assert.equal(new URL(url).hostname, "api.deezer.com");
    fallbackCalls++;
    setTimeout(() => releasePrimary(json({ artists: [{ name, id: mbid }] })), 10);
    return json({}, 503);
  };
  try {
    const result = await lookup(name);
    assert.equal(result.artist.mbid, mbid);
    assert.equal(result.providerFallback, undefined);
    assert.equal(fallbackCalls, 1);
  } finally { globalThis.fetch = blockedFetch; }
});

test("MusicBrainz Retry-After remains above an hour and counts down through cached route failures", async () => {
  const realNow = Date.now;
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls++;
    if (new URL(url).hostname === "musicbrainz.org") return json({}, 503, { "Retry-After": "7200" });
    assert.equal(new URL(url).hostname, "api.deezer.com");
    return json({ data: [] });
  };
  try {
    let first;
    await assert.rejects(lookup("Availability MusicBrainz Retry Fixture"), (error) => {
      first = error;
      return unavailable(error) && error.cause.provider === "MusicBrainz" && error.retryAfterMs > 7_000_000;
    });
    Date.now = () => realNow() + 60_000;
    await assert.rejects(lookup("Availability MusicBrainz Retry Fixture"), (error) => unavailable(error)
      && error.retryAt === first.retryAt && error.retryAfterMs <= first.retryAfterMs - 60_000);
    assert.equal(calls, 2);
  } finally { Date.now = realNow; globalThis.fetch = blockedFetch; }
});
