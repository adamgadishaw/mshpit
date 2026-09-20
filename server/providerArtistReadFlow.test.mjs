import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pit-provider-artist-read-"));
process.env.PIT_DATA_DIR = directory;
const { db } = await import("./db.js");
const { ticketmasterRows, upsertProviderTourDateRows } = await import("./tourdates.js");
const { routes } = await import("./api.js");
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
const context = (params = {}, query = {}) => ({ params, query, ip: "provider-artist-read-test", setHeader() {} });

test("trusted Discover import opens a local artist page and schedule without MusicBrainz or read-time writes", async () => {
  const name = "Provider Read Flow Fixture";
  const key = name.toLowerCase();
  const id = "provider-read-flow-event";
  const date = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const data = { _embedded: { events: [{
    id, name: `${name} - Live`, url: "https://www.ticketmaster.ca/event/provider-read-flow-event",
    dates: { start: { localDate: date }, status: { code: "onsale" } },
    classifications: [{ primary: true, segment: { id: "KZFzniwnSyZfZ7v7nJ", name: "Music" } }],
    _embedded: {
      attractions: [{ id: "K8ProviderReadFixture", name,
        classifications: [{ primary: true, segment: { id: "KZFzniwnSyZfZ7v7nJ", name: "Music" } }] }],
      venues: [{ id: "KovProviderReadHall", name: "Provider Read Hall", city: { name: "Toronto" },
        country: { countryCode: "CA", name: "Canada" } }],
    },
  }] } };
  const input = ticketmasterRows(data);
  assert.equal(input.length, 1);
  upsertProviderTourDateRows(db, input);
  const stored = db.prepare("SELECT * FROM artists WHERE norm=?").get(key);
  assert.ok(stored, "the existing provider import registers its missing artist locally");
  assert.equal(stored.mbid, null, "a Ticketmaster ID is not an inferred MusicBrainz identity");
  assert.equal(stored.photo, null, "registration does not download or invent media");
  assert.equal(db.prepare("SELECT 1 FROM artist_profiles WHERE artist_key=?").get(key), undefined);
  upsertProviderTourDateRows(db, input);
  assert.equal(db.prepare("SELECT COUNT(*) total FROM artists WHERE norm=?").get(key).total, 1);
  const before = db.prepare("SELECT total_inserted FROM provider_artist_registration_budget WHERE id=1").get();

  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error("This navigation must not call a provider"); };
  db.exec("PRAGMA query_only=ON");
  try {
    const event = routes["GET /api/resolve"](context({}, { path: `/event/tm_${id}` })).entity;
    assert.equal(event.artist, name);
    assert.equal(event.artistKey, key);
    assert.equal(event.artistIdentityPending, false);
    const resolved = await routes["GET /api/artists/resolve"](context({}, { name }));
    assert.equal(resolved.artist.key, key);
    assert.equal(resolved.artist.publicSlug, stored.public_slug);
    assert.equal(resolved.transient, undefined);
    assert.equal(resolved.created, false);
    const params = { key: encodeURIComponent(key) };
    const profile = routes["GET /api/artists/:key/profile"](context(params));
    assert.equal(profile.artist.key, key);
    assert.equal(profile.legacyProfile, false);
    assert.equal(profile.profile, null);
    const memorial = routes["GET /api/artists/:key/memorial"](context(params));
    assert.equal(memorial.memorial, null);
    const summary = routes["GET /api/artists/:key/live-summary"](context(params));
    assert.equal(summary.schedule.total, 1);
    assert.equal(summary.schedule.items[0].id, `tm_${id}`);
    const publicLink = routes["GET /api/resolve"](context({}, { path: `/artist/${stored.public_slug}` }));
    assert.equal(publicLink.entity.name, name);
    assert.equal(calls, 0);
    assert.deepEqual(db.prepare("SELECT total_inserted FROM provider_artist_registration_budget WHERE id=1").get(), before);
  } finally {
    db.exec("PRAGMA query_only=OFF");
    globalThis.fetch = originalFetch;
  }
});
