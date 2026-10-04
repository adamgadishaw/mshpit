import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { publicVenueSnapshotRoutes } from "./publicVenueSnapshot.js";
import { publicBrowserDestination } from "../../../src/domain/publicBrowserDestination.mjs";
import { normalizePublicVenueSnapshot } from "../../../src/domain/publicVenueSnapshot.mjs";

const directory = mkdtempSync(join(tmpdir(), "pit-venue-hydration-"));
process.env.PIT_DATA_DIR = directory;
const { db, q } = await import("../../db.js");
const { resolveEntity, publicVenueSnapshotForPath, publicDocumentForPath } = await import("../../seo.js");
const canonical = "/venue/ticketmaster-rz7hnezaeot";
// Synthetic provider spelling for the real public canonical; no live DB data.
const identity = { source: "ticketmaster", providerVenueId: "rZ7HnEZaeot" };
const add = (id, extra = {}) => {
  const row = { id, artist: "Hydration Band", venue: "Lee's Palace", date: "2036-06-14", source: identity.source,
    venue_provider_id: identity.providerVenueId, place: "Toronto, Ontario, Canada", venue_city: "Toronto", venue_region: "ON",
    venue_country: "Canada", venue_country_code: "CA", venue_address_line1: "529 Bloor Street West", venue_postal_code: "M5S 1Y5",
    lat: 43.665249, lng: -79.409447, release_at: 0, updated_at: 1, music_qualified: 1, provider_active: 1,
    event_kind: "concert", event_name: `Hydration Band ${id}`, billed_artists: '["Hydration Band"]',
    music_evidence: "ticketmaster:classification:music", event_status: "scheduled", ...extra };
  db.prepare(`INSERT INTO tour_dates (${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row));
};
for (let i = 0; i < 11; i++) add(`lee-${String(i).padStart(2, "0")}`);
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

test("cold guest alias and canonical preserve exact identity, address and bounded events without a startup cache", async () => {
  for (const path of ["/venue/lees-palace", canonical]) {
    const entity = resolveEntity(path);
    assert.equal(entity.path, canonical);
    assert.equal(entity.providerVenueId, identity.providerVenueId);
    assert.equal(entity.source, identity.source);
    const destination = await publicBrowserDestination(path, { resolveEntity: async () => entity });
    assert.equal(destination.path, canonical);
    assert.equal(destination.stack.at(-1).venue.city, "Toronto");
    const snapshot = publicVenueSnapshotForPath(path);
    const client = normalizePublicVenueSnapshot(snapshot, { path, identity: entity });
    assert.ok(client);
    assert.equal(client.venue.address.streetAddress, "529 Bloor Street West");
    assert.equal(client.venue.address.postalCode, "M5S 1Y5");
    assert.match(client.venue.place, /Toronto/);
    assert.equal(client.events.length, 8);
    assert.equal(client.hasMore, true);
    assert.equal(Object.hasOwn(client, "total"), false);
    assert.deepEqual(snapshot.venue.address, publicDocumentForPath(canonical).venue.address);
    assert.deepEqual(Object.keys(snapshot).sort(), ["after", "events", "hasMore", "nextCursor", "path", "venue"]);
    assert.doesNotMatch(JSON.stringify(snapshot), /owner_id|user_id|password|venueReviews|"posts"|expectedHash/);
  }
});

test("cursor pages advance through ties, recheck visibility, and stay bound to the canonical venue", () => {
  const first = publicVenueSnapshotForPath(canonical);
  db.prepare("UPDATE tour_dates SET provider_active=0 WHERE id='lee-08'").run();
  const second = publicVenueSnapshotForPath("/venue/lees-palace", first.nextCursor);
  assert.deepEqual(second.events.map(event => event.id), ["lee-09", "lee-10"]);
  assert.equal(second.hasMore, false);
  assert.equal(second.nextCursor, null);
  assert.equal(second.after, first.nextCursor);
  assert.ok(second.events.every(event => !first.events.some(prior => prior.id === event.id)));
  for (const after of ["invalid", "x".repeat(1025), Buffer.from(JSON.stringify({ path: "/venue/other", date: "2036-06-14", id: "lee-07" })).toString("base64url")]) {
    assert.throws(() => publicVenueSnapshotForPath(canonical, after), error => error.code === "VALIDATION_FAILED");
  }
  db.prepare("UPDATE tour_dates SET provider_active=1 WHERE id='lee-08'").run();
});

test("exact provider pages never merge namesakes; unpublished, inactive, cancelled and restricted rows stay out", () => {
  add("other-source", { source: "eventbrite", venue_city: "Ottawa", venue_address_line1: "Other building" });
  add("other-room", { venue_provider_id: "other-room", venue_city: "Halifax" });
  q.insertUser.run("restricted-venue-owner", "fixture@example.test", "Fixture", "fixturevenue", "inert", "fan", null, null, null, "CA", "#111111", 1);
  db.prepare("UPDATE users SET is_banned=1 WHERE id='restricted-venue-owner'").run();
  for (const [id, extra] of [
    ["unreleased", { release_at: Date.now() + 86_400_000 }], ["inactive", { provider_active: 0 }],
    ["nonmusic", { music_qualified: 0 }], ["cancelled", { event_status: "cancelled" }], ["canceled", { event_status: " CANCELED " }],
    ["restricted", { owner_id: "restricted-venue-owner" }], ["invalid", { date: "2036-02-30" }],
  ]) add(id, extra);
  assert.equal(resolveEntity("/venue/lees-palace"), null, "Ambiguous aliases do not pick a namesake");
  const first = publicVenueSnapshotForPath(canonical);
  const second = publicVenueSnapshotForPath(canonical, first.nextCursor);
  assert.equal([...first.events, ...second.events].length, 11);
  assert.ok([...first.events, ...second.events].every(event => event.id.startsWith("lee-")));
  const other = publicVenueSnapshotForPath("/venue/eventbrite-rz7hnezaeot");
  assert.deepEqual(other.events.map(event => event.id), ["other-source"]);
  assert.equal(other.venue.address.streetAddress, "Other building");
  assert.throws(() => publicVenueSnapshotForPath(other.path, first.nextCursor), error => error.code === "VALIDATION_FAILED");
});

test("anonymous HTTP snapshot uses bounded public projection and admission happens before reads", async () => {
  let limited = 0, reads = 0;
  const route = publicVenueSnapshotRoutes({ rateLimit() { limited++; }, readSnapshot(...args) { reads++; return publicVenueSnapshotForPath(...args); } })["GET /api/venue-snapshot"];
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    try {
      const body = route({ query: Object.fromEntries(url.searchParams), user: null, setHeader: res.setHeader.bind(res) });
      res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(body));
    } catch (error) { res.writeHead(error.status || 500); res.end(JSON.stringify({ code: error.code })); }
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${origin}/api/venue-snapshot?path=${encodeURIComponent(canonical)}`);
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.json()).events.length, 8);
    const invalid = await fetch(`${origin}/api/venue-snapshot?path=${encodeURIComponent("/event/private")}`);
    assert.equal(invalid.status, 400); assert.equal(reads, 1); assert.equal(limited, 2);
    const blocked = publicVenueSnapshotRoutes({ rateLimit() { throw new Error("limited"); }, readSnapshot() { assert.fail("No read after rejection"); } })["GET /api/venue-snapshot"];
    assert.throws(() => blocked({ query: { path: canonical } }), /limited/);
  } finally { await new Promise(done => server.close(done)); }
});

test("missing provider URLs cannot fall back to a display name; raw identity validation preserves existing canonical policy", () => {
  add("provider-looking-name", { venue: "Ticketmaster Missing", venue_provider_id: "real-distinct-room" });
  assert.equal(resolveEntity("/venue/ticketmaster-missing"), null);
  assert.equal(publicVenueSnapshotForPath("/venue/ticketmaster-missing"), null);
  assert.equal(resolveEntity("/venue/ticketmaster-real-distinct-room").name, "Ticketmaster Missing");
  add("slug-collision", { venue: "Different building", venue_provider_id: "rz7hnezaeot", venue_city: "Montreal", updated_at: 99 });
  const selected = resolveEntity(canonical);
  assert.equal(selected.providerVenueId, "rz7hnezaeot", "Existing SSR/sitemap policy selects the latest music-backed raw identity");
  const snapshot = publicVenueSnapshotForPath(canonical);
  assert.deepEqual(snapshot.events.map(event => event.id), ["slug-collision"]);
  assert.deepEqual(snapshot.venue.address, publicDocumentForPath(canonical).venue.address);
  assert.equal(normalizePublicVenueSnapshot(snapshot, { path: canonical, identity }), null, "An explicitly different provider identity must never adopt the canonical's data");
  assert.ok(normalizePublicVenueSnapshot(snapshot, { path: canonical, identity: selected }));
});

test("private or held artist-authored venues cannot supply resolver or snapshot identities", () => {
  for (const state of ["pending", "removed", "only_me", "members"]) {
    const owner = `private-venue-owner-${state}`, artist = `private-venue-artist-${state}`, providerId = `private-venue-${state.replaceAll("_", "-")}`;
    q.insertUser.run(owner, `${owner}@example.test`, owner, owner, "inert", "artist", null, null, null, "VH", "#111111", 1);
    db.prepare("INSERT INTO artists (norm,name,source,public_slug,created_at,updated_at) VALUES (?,?,?,?,?,?)").run(artist, artist, "artist-created", artist, 1, 1);
    db.prepare("INSERT INTO artist_profiles (artist_key,owner_id,removed,identity_review_status) VALUES (?,?,?,?)").run(artist, owner, state === "removed" ? 1 : 0, state === "pending" ? state : "clear");
    if (["only_me", "members"].includes(state)) db.prepare("UPDATE users SET profile_audience=? WHERE id=?").run(state, owner);
    add(providerId, { owner_id: owner, artist, artist_key: artist, venue: "Private venue name", venue_provider_id: providerId });
    const path = `/venue/ticketmaster-${providerId}`;
    assert.equal(resolveEntity(path), null);
    assert.equal(publicVenueSnapshotForPath(path), null);
  }
});
