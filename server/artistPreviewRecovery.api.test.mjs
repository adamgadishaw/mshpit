import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const directory = mkdtempSync(join(tmpdir(), "pit-preview-recovery-"));
process.env.PIT_DATA_DIR = directory;
const { db, artistStmts, providerCacheStmts } = await import("./db.js");
const { routes } = await import("./api.js");
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

test("slow uncached MusicBrainz search can recover in the real route without persisting a fallback identity", { timeout: 8_000 }, async () => {
  const name = "Slow Artist Recovery Fixture";
  const originalFetch = globalThis.fetch;
  let musicBrainzCalls = 0, fallbackCalls = 0, musicBrainzSignal;
  const at = Date.now();
  try {
    globalThis.fetch = async (url, options) => {
      if (String(url).includes("musicbrainz.org")) {
        musicBrainzCalls++;
        musicBrainzSignal = options.signal;
        return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
      }
      assert.match(String(url), /api\.deezer\.com\/search\/artist/);
      fallbackCalls++;
      return new Response(JSON.stringify({ data: [{ id: 574829, name, nb_fan: 10 }] }));
    };
    const result = await routes["GET /api/artists/resolve"]({ query: { name }, ip: "preview-recovery" });
    assert.ok(Date.now() - at < 4_500, "usable preview need not wait for the six-second primary timeout");
    assert.equal(musicBrainzCalls, 1);
    assert.equal(fallbackCalls, 1);
    assert.equal(musicBrainzSignal.aborted, true);
    assert.equal(result.providerFallback, "deezer");
    assert.equal(result.artist.mbid, null);
    assert.equal(result.transient, true);
    assert.equal(artistStmts.byNorm.get(name.toLowerCase()), undefined);
  } finally { globalThis.fetch = originalFetch; }
});

test("real route does not launch a fallback for a promptly resolved MusicBrainz identity", async () => {
  const originalFetch = globalThis.fetch;
  const name = "Fast Artist Recovery Fixture", mbid = "12345678-9abc-4def-8123-456789abcdef";
  try {
    globalThis.fetch = async (url) => {
      assert.match(String(url), /musicbrainz\.org/, "no extra provider for normal lookups");
      return new Response(JSON.stringify({ artists: [{ id: mbid, name, score: 100 }] }));
    };
    const result = await routes["GET /api/artists/resolve"]({ query: { name }, ip: "preview-recovery-fast" });
    assert.equal(result.artist.mbid, mbid);
    assert.equal(result.providerFallback, undefined);
  } finally { globalThis.fetch = originalFetch; }
});

test("a hedged namesake or near-match never wins over the verified primary identity", { timeout: 8_000 }, async () => {
  const originalFetch = globalThis.fetch;
  const mbid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  try {
    for (const variant of ["ambiguous", "near-match"]) {
      const name = `Hedged Identity ${variant} Fixture`;
      let releasePrimary, fallbackCalls = 0;
      globalThis.fetch = async (url) => {
        if (String(url).includes("musicbrainz.org")) {
          return new Promise((resolve) => { releasePrimary = resolve; });
        }
        fallbackCalls++;
        const candidates = variant === "ambiguous"
          ? [{ id: 4411, name }, { id: 4412, name }]
          : [{ id: 4413, name: name + " Tribute" }];
        setTimeout(() => releasePrimary(new Response(JSON.stringify({ artists: [{ id: mbid, name, score: 100 }] }))), 25);
        return new Response(JSON.stringify({ data: candidates }));
      };
      const result = await routes["GET /api/artists/resolve"]({ query: { name }, ip: "hedged-identity" });
      assert.equal(fallbackCalls, 1);
      assert.equal(result.artist.mbid, mbid);
      assert.equal(result.providerFallback, undefined);
      assert.equal(providerCacheStmts.get.get("dzresolve:v1:" + name.toLowerCase()), undefined);
      assert.equal(artistStmts.byNorm.get(name.toLowerCase()), undefined);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test("a fallback winner cannot let an abort-ignoring late primary overwrite the durable answer", { timeout: 8_000 }, async () => {
  const originalFetch = globalThis.fetch;
  const name = "Late Primary Recovery Fixture";
  let releasePrimary, primarySignal;
  try {
    globalThis.fetch = async (url, options) => {
      if (String(url).includes("musicbrainz.org")) {
        primarySignal = options.signal;
        return new Promise((resolve) => { releasePrimary = resolve; });
      }
      return new Response(JSON.stringify({ data: [{ id: 554433, name }] }));
    };
    const result = await routes["GET /api/artists/resolve"]({ query: { name }, ip: "late-primary" });
    assert.equal(result.providerFallback, "deezer");
    assert.equal(primarySignal.aborted, true);
    releasePrimary(new Response(JSON.stringify({ artists: [{
      id: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff", name, score: 100,
    }] })));
    await new Promise((resolve) => setImmediate(resolve));
    globalThis.fetch = async () => assert.fail("repeat lookup must use its safe durable fallback");
    const repeated = await routes["GET /api/artists/resolve"]({ query: { name }, ip: "late-primary" });
    assert.equal(repeated.providerFallback, "deezer");
    assert.equal(repeated.cached, true);
    assert.equal(repeated.artist.mbid, null);
    assert.equal(providerCacheStmts.get.get("mbresolve:v1:" + name.toLowerCase()), undefined);
    assert.equal(artistStmts.byNorm.get(name.toLowerCase()), undefined);
  } finally {
    releasePrimary?.(new Response(JSON.stringify({ artists: [] })));
    globalThis.fetch = originalFetch;
  }
});

test("cancelled interactive lookup publishes and persists neither provider answer", { timeout: 5_000 }, async () => {
  const originalFetch = globalThis.fetch;
  const name = "Cancelled Preview Recovery Fixture";
  const controller = new AbortController();
  let announceStart;
  const started = new Promise((resolve) => { announceStart = resolve; });
  try {
    globalThis.fetch = async (url, options) => {
      assert.match(String(url), /musicbrainz\.org/, "cancellation before the hedge avoids fallback traffic");
      announceStart();
      return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
    };
    const pending = routes["GET /api/artists/resolve"]({ query: { name }, ip: "cancelled-preview", signal: controller.signal });
    await started;
    controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(providerCacheStmts.get.get("mbresolve:v1:" + name.toLowerCase()), undefined);
    assert.equal(providerCacheStmts.get.get("dzresolve:v1:" + name.toLowerCase()), undefined);
    assert.equal(artistStmts.byNorm.get(name.toLowerCase()), undefined);
  } finally { controller.abort(); globalThis.fetch = originalFetch; }
});
