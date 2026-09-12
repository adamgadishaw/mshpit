import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const directory = mkdtempSync(join(tmpdir(), "pit-artist-lookup-recovery-"));
process.env.PIT_DATA_DIR = directory;
const { db, artistStmts, artistRow, providerCacheStmts } = await import("./db.js");
const { routes } = await import("./api.js");
const { pruneExpiredProviderData } = await import("./musicProviders.js");
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

const name = "A$AP Rocky", key = "a$ap rocky", mbid = "25b7b584-d952-4662-a8b9-dd8cdfbfeb64";
const context = (params = {}, query = {}) => ({ params, query, ip: "artist-recovery-test", setHeader() {} });

test("reviewed missing artist is registered and both exact spellings find its canonical identity", () => {
  assert.equal(artistStmts.byNorm.get(key)?.mbid, mbid);
  for (const q of [name, "ASAP Rocky"]) {
    const result = routes["GET /api/artists"](context({}, { q, limit: "5" }));
    assert.equal(result.artists[0].key, key);
    assert.equal(result.artists[0].mbid, mbid);
  }
});

test("reviewed alias resolves locally and reads actual stored dates through the registered route", async () => {
  const date = new Date(Date.now() + 31 * 86400000).toISOString().slice(0, 10);
  db.prepare(`INSERT INTO tour_dates(id,artist,artist_key,venue,place,date,source,updated_at)
    VALUES(?,?,?,?,?,?,?,?)`).run("reviewed-rocky-date", name, key, "Fixture Hall", "Toronto", date, "ticketmaster", Date.now());
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Persisted artist reads must not call a provider"); };
  try {
    const resolved = await routes["GET /api/artists/resolve"](context({}, { name: "ASAP Rocky" }));
    assert.equal(resolved.artist.key, key);
    assert.equal(resolved.transient, undefined);
    for (const reference of [key, "ASAP Rocky", resolved.artist.publicSlug]) {
      const headers = {};
      const result = routes["GET /api/artists/:key/live-summary"]({ ...context({ key: encodeURIComponent(reference) }),
        setHeader: (field, value) => { headers[field] = value; } });
      assert.deepEqual(result.artist, { key, name });
      assert.equal(result.schedule.total, 1);
      assert.equal(result.schedule.items[0].id, "reviewed-rocky-date");
      assert.equal(result.schedule.items[0].date, date);
      assert.equal(headers["Cache-Control"], "private, no-store");
    }
  } finally { globalThis.fetch = originalFetch; }
});

test("unknown artists remain an explicit missing record, never an empty successful schedule", () => {
  assert.throws(() => routes["GET /api/artists/:key/live-summary"](context({ key: "unregistered-fixture-artist" })),
    (error) => error.status === 404 && error.code === "NOT_FOUND");
});

test("public provider outage is distinguishable from no matching artist and never writes the catalog", async () => {
  const originalFetch = globalThis.fetch;
  const count = artistStmts.count.get().c;
  try {
    globalThis.fetch = async () => ({ ok: false, status: 503 });
    await assert.rejects(routes["GET /api/artists/resolve"](context({}, { name: "Recovery Outage Fixture" })),
      (error) => error.status === 502 && error.code === "PROVIDER_UNAVAILABLE");
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ artists: [] }) });
    const missing = await routes["GET /api/artists/resolve"](context({}, { name: "Recovery Empty Fixture" }));
    assert.deepEqual(missing, { artist: null, created: false });
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ artists: [{
      name: "Recovery Transient Fixture", id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", score: 100,
    }] }) });
    const preview = await routes["GET /api/artists/resolve"](context({}, { name: "Recovery Transient Fixture" }));
    assert.equal(preview.transient, true);
    assert.equal(preview.created, false);
    assert.equal(artistStmts.byNorm.get("recovery transient fixture"), undefined);
    assert.equal(artistStmts.count.get().c, count);
  } finally { globalThis.fetch = originalFetch; }
});

test("an existing exact-name artist takes priority over a reviewed spelling alias", async () => {
  const otherId = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
  artistStmts.upsert.run(artistRow("asap rocky", { name: "ASAP Rocky", mbid: otherId }, "test"));
  const resolved = await routes["GET /api/artists/resolve"](context({}, { name: "ASAP Rocky" }));
  assert.equal(resolved.artist.key, "asap rocky");
  assert.equal(resolved.artist.mbid, otherId);
  const searched = routes["GET /api/artists"](context({}, { q: "ASAP Rocky" }));
  assert.equal(searched.artists[0].key, "asap rocky");
});

test("a fresh remembered artist resolves immediately without another provider request", async () => {
  const originalFetch = globalThis.fetch;
  const remembered = { name: "Outage Memory Fixture", id: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff", score: 100 };
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => ({ artists: [remembered] }) };
    };
    const first = await routes["GET /api/artists/resolve"](context({}, { name: remembered.name }));
    assert.equal(first.artist.mbid, remembered.id);
    assert.equal(first.stale, undefined);

    globalThis.fetch = async () => {
      calls += 1;
      return { ok: false, status: 503 };
    };
    const served = await routes["GET /api/artists/resolve"](context({}, { name: remembered.name }));
    assert.equal(served.artist.mbid, remembered.id);
    assert.equal(served.artist.name, remembered.name);
    assert.equal(served.cached, true);
    assert.equal(served.stale, undefined);
    assert.equal(served.transient, true);
    assert.equal(calls, 1, "fresh immutable identity cache bypasses the provider gate");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a MusicBrainz outage performs no retry amplification and uses one safe exact Deezer fallback", async () => {
  const originalFetch = globalThis.fetch;
  let musicBrainzCalls = 0;
  let deezerCalls = 0;
  try {
    globalThis.fetch = async (url) => {
      if (String(url).includes("musicbrainz.org")) {
        musicBrainzCalls += 1;
        return { ok: false, status: 503 };
      }
      if (String(url).includes("api.deezer.com/search/artist")) {
        deezerCalls += 1;
        return { ok: true, status: 200, json: async () => ({ data: [{
          id: 4242,
          name: "Recovery Deezer Fixture",
          nb_fan: 500_000,
          nb_album: 4,
          picture_medium: "https://e-cdns-images.dzcdn.net/images/artist/recovery/250x250.jpg",
        }] }) };
      }
      throw new Error("unexpected provider");
    };
    const resolved = await routes["GET /api/artists/resolve"](context({}, { name: "Recovery Deezer Fixture" }));
    assert.equal(musicBrainzCalls, 1, "one interactive lookup makes at most one MusicBrainz attempt");
    assert.equal(deezerCalls, 1);
    assert.equal(resolved.artist.name, "Recovery Deezer Fixture");
    assert.equal(resolved.providerFallback, "deezer");
    assert.equal(resolved.stale, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("concurrent identical artist lookups share one MusicBrainz request", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let announceStart;
  let releaseFetch;
  const started = new Promise((resolve) => { announceStart = resolve; });
  const held = new Promise((resolve) => { releaseFetch = resolve; });
  try {
    globalThis.fetch = async (url) => {
      assert.match(String(url), /musicbrainz\.org/);
      calls += 1;
      announceStart();
      await held;
      return { ok: true, status: 200, json: async () => ({ artists: [{
        name: "Coalesced Artist Fixture",
        id: "dddddddd-eeee-4fff-8aaa-bbbbbbbbbbbb",
        score: 100,
      }] }) };
    };
    const first = routes["GET /api/artists/resolve"](context({}, { name: "Coalesced Artist Fixture" }));
    await started;
    const second = routes["GET /api/artists/resolve"](context({}, { name: "Coalesced Artist Fixture" }));
    releaseFetch();
    const results = await Promise.all([first, second]);
    assert.equal(calls, 1);
    assert.equal(results[0].artist.mbid, results[1].artist.mbid);
  } finally {
    releaseFetch?.();
    globalThis.fetch = originalFetch;
  }
});

test("same-named Deezer candidates fail closed instead of binding an ambiguous fallback", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      if (String(url).includes("musicbrainz.org")) return { ok: false, status: 503 };
      return { ok: true, status: 200, json: async () => ({ data: [
        { id: 1, name: "Ambiguous Recovery Fixture", nb_fan: 900 },
        { id: 2, name: "Ambiguous Recovery Fixture", nb_fan: 900_000 },
      ] }) };
    };
    await assert.rejects(
      routes["GET /api/artists/resolve"](context({}, { name: "Ambiguous Recovery Fixture" })),
      (error) => error.status === 502 && error.code === "PROVIDER_UNAVAILABLE",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("expired exact identity cache survives pruning and serves during a later outage", async () => {
  const originalFetch = globalThis.fetch;
  const artist = {
    name: "Durable Recovery Fixture",
    id: "eeeeeeee-ffff-4aaa-8bbb-cccccccccccc",
    score: 100,
  };
  const cacheKey = "mbresolve:v1:durable recovery fixture";
  try {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ artists: [artist] }),
    });
    await routes["GET /api/artists/resolve"](context({}, { name: artist.name }));
    const remembered = providerCacheStmts.get.get(cacheKey);
    assert.ok(remembered);
    providerCacheStmts.set.run(cacheKey, remembered.data, remembered.updated_at, 1);
    pruneExpiredProviderData(Date.now(), { force: true });
    assert.ok(providerCacheStmts.get.get(cacheKey), "hourly pruning preserves the bounded last-known identity record");

    globalThis.fetch = async () => ({ ok: false, status: 503 });
    const served = await routes["GET /api/artists/resolve"](context({}, { name: artist.name }));
    assert.equal(served.artist.mbid, artist.id);
    assert.equal(served.cached, true);
    assert.equal(served.stale, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an artist never resolved before still fails honestly during an outage", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: false, status: 503 });
    await assert.rejects(
      routes["GET /api/artists/resolve"](context({}, { name: "Never Seen Outage Fixture" })),
      (error) => error.status === 502 && error.code === "PROVIDER_UNAVAILABLE",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
