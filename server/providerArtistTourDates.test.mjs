import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "pit-provider-registration-"));
process.env.PIT_DATA_DIR = dataDir;
const { db, artistRow, artistStmts } = await import("./db.js");
const { ticketmasterRows, upsertProviderTourDateRows } = await import("./tourdates.js");
const AT = Date.parse("2026-09-20T12:00:00Z");
after(() => { db.close(); rmSync(dataDir, { recursive: true, force: true }); });
beforeEach(() => {
  db.exec(`DELETE FROM tour_dates; DELETE FROM artist_profiles; DELETE FROM artists; DELETE FROM users;
    UPDATE provider_artist_registration_budget SET utc_day='',daily_inserted=0,total_inserted=0`);
});
function event({ id = "Event-One", name = "Future Performer", attractionId = "Artist-One", attractions } = {}) {
  return { id, name: `${name} - Live`, url: "https://www.ticketmaster.com/event/Event-One",
    classifications: [{ primary: true, segment: { id: "KZFzniwnSyZfZ7v7nJ", name: "Music" } }],
    dates: { start: { localDate: "2027-01-20" } },
    _embedded: { attractions: attractions || [{ id: attractionId, name }],
      venues: [{ id: "Venue-One", name: "Music Hall", city: { name: "Toronto" }, country: { countryCode: "CA", name: "Canada" } }] } };
}
const rows = (events) => ticketmasterRows({ _embedded: { events } });
const lookup = (id = "tm_Event-One") => db.prepare("SELECT * FROM tour_dates WHERE id=?").get(id);
const count = () => db.prepare("SELECT count(*) AS count FROM artists").get().count;

test("actual Ticketmaster ingestion registers once, binds exact ID, and keeps unchanged SEO timestamps", () => {
  const providerRows = rows([event()]);
  assert.equal(providerRows[0].provider_artist_id, "Artist-One");
  assert.equal(upsertProviderTourDateRows(db, providerRows, { seenAt: AT }), 1);
  assert.equal(count(), 1);
  assert.equal(lookup().artist_key, "future performer");
  assert.equal(lookup().artist_identity_status, "registered");
  assert.equal(lookup().provider_artist_id, "Artist-One");
  const before = artistStmts.byNorm.get("future performer");
  upsertProviderTourDateRows(db, providerRows, { seenAt: AT + 1000 });
  assert.equal(lookup().updated_at, AT); assert.equal(lookup().last_seen_at, AT + 1000);
  assert.deepEqual(artistStmts.byNorm.get("future performer"), before);
});

test("different attraction IDs with the same name are explicitly conflicted in the whole event batch", () => {
  upsertProviderTourDateRows(db, rows([event(), event({ id: "Other-Event", attractionId: "Other-Artist" })]), { seenAt: AT });
  assert.equal(count(), 0);
  for (const id of ["tm_Event-One", "tm_Other-Event"]) {
    assert.equal(lookup(id).artist_identity_status, "conflict"); assert.equal(lookup(id).artist_key, null);
  }
});

test("event-title fallback is not an artist and exposes pending matching instead of a fake page", () => {
  const providerRows = rows([event({ attractions: [] })]);
  upsertProviderTourDateRows(db, providerRows, { seenAt: AT });
  assert.equal(count(), 0); assert.equal(lookup().artist_key, null);
  assert.equal(lookup().artist_identity_status, "pending");
});

test("requestedArtist and joint attraction mismatches cannot create requested artist identities", () => {
  const input = { _embedded: { events: [event({ name: "USHER RAYMOND & CHRIS BROWN", attractionId: "K8vZ917LxIV" })] } };
  const providerRows = ticketmasterRows(input, { requestedArtist: "Chris Brown" });
  assert.equal(providerRows.length, 1); assert.equal(providerRows[0].provider_artist_id, null);
  upsertProviderTourDateRows(db, providerRows, { seenAt: AT });
  assert.equal(count(), 0); assert.equal(lookup().artist_identity_status, "pending");
  assert.deepEqual(ticketmasterRows(input, { requestedArtist: "Wrong Artist" }), []);
});

test("an authored-event ID collision cannot create catalogue metadata or spend registration budget", () => {
  db.prepare("INSERT INTO users(id,email,name,handle,pass_hash,created_at) VALUES (?,?,?,?,?,?)")
    .run("owner", "owner@example.test", "Owner", "owner", "test", AT);
  db.prepare("INSERT INTO tour_dates(id,artist,venue,date,source,updated_at,owner_id) VALUES (?,?,?,?,?,?,?)")
    .run("tm_Event-One", "Owned Performer", "Private Hall", "2027-01-20", "artist", AT, "owner");
  const before = lookup();
  assert.equal(upsertProviderTourDateRows(db, rows([event()]), { seenAt: AT + 1 }), 0);
  assert.equal(count(), 0); assert.deepEqual(lookup(), before);
  assert.equal(db.prepare("SELECT total_inserted FROM provider_artist_registration_budget").get().total_inserted, 0);
});

test("a failed event write rolls back its artist, exact mapping and counter together", () => {
  db.exec("CREATE TRIGGER reject_provider_event BEFORE INSERT ON tour_dates WHEN NEW.id='tm_Event-One' BEGIN SELECT RAISE(ABORT,'event test rejection'); END");
  try {
    assert.throws(() => upsertProviderTourDateRows(db, rows([event()]), { seenAt: AT }), /event test rejection/);
    assert.equal(count(), 0); assert.equal(lookup(), undefined);
    assert.equal(db.prepare("SELECT count(*) AS count FROM provider_artist_identities").get().count, 0);
    assert.equal(db.prepare("SELECT total_inserted FROM provider_artist_registration_budget").get().total_inserted, 0);
  } finally { db.exec("DROP TRIGGER reject_provider_event"); }
});

test("a later incomplete response cannot erase a held namesake's conflict", () => {
  artistStmts.upsert.run(artistRow("future performer", { name: "Future Performer" }, "artist-created"));
  upsertProviderTourDateRows(db, rows([event()]), { seenAt: AT });
  assert.equal(lookup().artist_identity_status, "conflict");
  const partial = rows([event({ attractions: [{ name: "Future Performer" }] })]);
  upsertProviderTourDateRows(db, partial, { seenAt: AT + 1 });
  assert.equal(lookup().artist_identity_status, "conflict"); assert.equal(lookup().artist_key, null);
  assert.equal(lookup().provider_artist_id, "Artist-One");
});

test("budget-pending identity stays restricted if a same-name catalogue row appears before an incomplete response", () => {
  upsertProviderTourDateRows(db, rows([event()]), { seenAt: AT, registrationLimits: { maxPerBatch: 0 } });
  assert.equal(lookup().artist_identity_status, "pending"); assert.equal(count(), 0);
  artistStmts.upsert.run(artistRow("future performer", { name: "Future Performer" }, "reviewed-identity"));
  upsertProviderTourDateRows(db, rows([event({ attractions: [{ name: "Future Performer" }] })]), { seenAt: AT + 1 });
  assert.equal(lookup().artist_identity_status, "pending"); assert.equal(lookup().artist_key, null);
  assert.equal(lookup().provider_artist_id, "Artist-One");
});

test("a budget-deferred event becomes registered only after an authoritative bounded retry", () => {
  const providerRows = rows([event()]);
  upsertProviderTourDateRows(db, providerRows, { seenAt: AT, registrationLimits: { maxPerBatch: 0 } });
  upsertProviderTourDateRows(db, providerRows, { seenAt: AT + 1 });
  assert.equal(lookup().artist_identity_status, "registered"); assert.equal(lookup().artist_key, "future performer");
  assert.equal(count(), 1);
});

test("same exact provider ID with renamed billing does not manufacture an alias or duplicate artist", () => {
  upsertProviderTourDateRows(db, rows([event()]), { seenAt: AT });
  upsertProviderTourDateRows(db, rows([event({ name: "Renamed Performer" })]), { seenAt: AT + 1 });
  assert.equal(lookup().artist_identity_status, "pending"); assert.equal(lookup().artist_key, null);
  assert.equal(count(), 1); assert.equal(artistStmts.byNorm.get("future performer").name, "Future Performer");
});
