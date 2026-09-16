import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const directory = mkdtempSync(join(tmpdir(), "pit-artist-fallback-recovery-"));
process.env.PIT_DATA_DIR = directory;
const { db, artistStmts, artistRow, providerCacheStmts } = await import("./db.js");
const { routes } = await import("./api.js");
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
const lookup = (name) => routes["GET /api/artists/resolve"]({
  query: { name }, ip: "fallback-recovery", setHeader() {},
});

test("successful exact fallback is durable and later lookup is read-only with both providers unavailable", async () => {
  const originalFetch = globalThis.fetch;
  const name = "Durable Fallback Recovery";
  const count = artistStmts.count.get().c;
  let calls = 0;
  try {
    globalThis.fetch = async (url) => {
      calls += 1;
      return new Response(JSON.stringify(String(url).includes("musicbrainz.org") ? { artists: [] } : {
        data: [{ id: 7654321, name, nb_fan: 100, picture_medium: "https://example.com/artwork.jpg" }],
      }));
    };
    const first = await lookup(name);
    assert.equal(first.providerFallback, "deezer");
    assert.equal(first.transient, true);
    assert.equal(calls, 2);
    const stored = providerCacheStmts.get.get("dzresolve:v1:durable fallback recovery");
    assert.ok(stored, "the fallback is persisted independently of the process-local work cache");
    assert.deepEqual(JSON.parse(stored.data), { name, deezerId: "7654321" });

    globalThis.fetch = async () => assert.fail("saved exact fallback must not call either provider");
    db.exec("PRAGMA query_only=ON");
    const recovered = await lookup(" DURABLE FALLBACK RECOVERY ");
    assert.equal(recovered.artist.name, name);
    assert.equal(recovered.artist.deezerId, "7654321");
    assert.equal(recovered.artist.mbid, null);
    assert.equal(recovered.cached, true);
    assert.equal(recovered.transient, true);
    assert.equal(recovered.created, false);
    assert.equal(recovered.providerFallback, "deezer");
    assert.equal(recovered.artist.photo, null, "optional provider artwork is not archived");
    assert.equal(artistStmts.byNorm.get(name.toLowerCase()), undefined);
    assert.equal(artistStmts.count.get().c, count, "a public lookup never creates a catalogue identity");
  } finally { db.exec("PRAGMA query_only=OFF"); globalThis.fetch = originalFetch; }
});

test("durable catalogue identity overrides an earlier provider fallback", async () => {
  const name = "Durable Fallback Recovery";
  const mbid = "eeeeeeee-ffff-4aaa-8bbb-cccccccccccc";
  artistStmts.upsert.run(artistRow(name, { name, mbid, bio: "Staff supplied fixture." }, "test"));
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => assert.fail("catalogue must take precedence");
    const result = await lookup(name);
    assert.equal(result.artist.mbid, mbid);
    assert.equal(result.providerFallback, undefined);
    assert.equal(result.transient, undefined);
    assert.equal(result.artist.bio, "Staff supplied fixture.");
  } finally { globalThis.fetch = originalFetch; }
});

test("ambiguous MusicBrainz preview is never persisted as the lasting answer for a name", async () => {
  const originalFetch = globalThis.fetch;
  const name = "Same Named Recovery Artists";
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ artists: [
      { name, id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", score: 100 },
      { name, id: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff", score: 100 },
    ] }));
    const result = await lookup(name);
    assert.equal(result.transient, true, "existing request-scoped preview behavior stays compatible");
    assert.equal(providerCacheStmts.get.get("mbresolve:v1:same named recovery artists"), undefined);
    assert.equal(artistStmts.byNorm.get(name.toLowerCase()), undefined);
  } finally { globalThis.fetch = originalFetch; }
});

test("invalid fallback identifiers cannot create a preview or a durable recovery record", async () => {
  const originalFetch = globalThis.fetch;
  const name = "Invalid Fallback Id";
  try {
    globalThis.fetch = async (url) => new Response(JSON.stringify(String(url).includes("musicbrainz.org")
      ? { artists: [] } : { data: [{ id: "../other-artist", name }] }));
    assert.deepEqual(await lookup(name), { artist: null, created: false });
    assert.equal(providerCacheStmts.get.get("dzresolve:v1:invalid fallback id"), undefined);
  } finally { globalThis.fetch = originalFetch; }
});

test("read-only optional cache cannot turn a successful MusicBrainz lookup into an error", async () => {
  const originalFetch = globalThis.fetch;
  const name = "Readonly Cache Recovery Artist";
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ artists: [{
      name, id: "cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa", score: 100,
    }] }));
    db.exec("PRAGMA query_only=ON");
    const result = await lookup(name);
    assert.equal(result.artist.name, name);
    assert.equal(result.artist.mbid, "cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa");
    assert.equal(result.transient, true);
    assert.equal(result.created, false);
    assert.equal(providerCacheStmts.get.get("mbresolve:v1:readonly cache recovery artist"), undefined);
  } finally { db.exec("PRAGMA query_only=OFF"); globalThis.fetch = originalFetch; }
});
