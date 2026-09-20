import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createArtistMemorialRepository } from "./features/artistMemorials/artistMemorialRepository.js";
import { createArtistMemorialService } from "./features/artistMemorials/artistMemorialService.js";

const directory = mkdtempSync(join(tmpdir(), "pit-public-event-snapshot-"));
process.env.PIT_DATA_DIR = directory;
const { db, q } = await import("./db.js");
const { resolveEntity, seoHttpPlan } = await import("./seo.js");
const { eventPath } = await import("../src/domain/urls.mjs");

after(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

function addArtist(key, name, mbid = null) {
  db.prepare(`INSERT INTO artists
    (norm,name,public_slug,search_key,genre,photo,bio,mbid,popularity,rank_score,data,source,created_at,updated_at)
    VALUES (?,?,?,?,'Rock',NULL,'',?,1,1,'{}','test',1,1)`)
    .run(key, name, key, key.replaceAll("-", ""), mbid);
}

function addEvent(id, overrides = {}) {
  const value = {
    name: "Club 1BD: Toronto", artist: "Club 1BD", artistKey: null,
    venue: "History", date: "2036-06-14", source: "ticketmaster", ownerId: null,
    releaseAt: 0, active: 1, musicQualified: 1, kind: "concert",
    billedArtists: ["Club 1BD"], ...overrides,
  };
  db.prepare(`INSERT INTO tour_dates
    (id,event_name,artist,artist_key,venue,place,date,source,owner_id,release_at,provider_active,
      music_qualified,event_kind,music_evidence,billed_artists,venue_provider_id,ticket_url,
      start_local_time,event_timezone,event_status,updated_at)
    VALUES (?,?,?,?,?,'Toronto, Canada',?,?,?,?,?,?,?,'ticketmaster:classification:music',?,
      'venue-history','https://www.ticketmaster.ca/event/fixture','20:00:00','America/Toronto','onsale',1)`)
    .run(id, value.name, value.artist, value.artistKey, value.venue, value.date, value.source,
      value.ownerId, value.releaseAt, value.active, value.musicQualified, value.kind,
      JSON.stringify(value.billedArtists));
  return eventPath(id);
}

function addMemorial(key, name, mbid, deathDate) {
  const service = createArtistMemorialService({ repository: createArtistMemorialRepository(db) });
  const saved = service.upsert({
    status: "published", deathDate,
    summary: "An influential musician remembered for performances and recordings shared by generations of listeners.",
    thankYou: "Thank you for the music and the memories.",
    accomplishments: ["An enduring recorded catalogue", "Live performances remembered by listeners"],
    sourceUrl: "https://news.example.org/verified-memorial",
    sourceTitle: "Verified memorial record", confirmedIndividual: true, restartSpotlight: false,
  }, { artistKey: key, artistName: name, artistMbid: mbid, at: Date.parse("2026-09-01T00:00:00Z") });
  assert.equal(saved.ok, true);
}

test("an exact eligible event without a catalogue artist resolves to a read-only public snapshot", () => {
  const path = addEvent("snapshot-no-artist");
  assert.equal(db.prepare("SELECT 1 FROM artists WHERE name='Club 1BD'").get(), undefined);
  const entity = resolveEntity(path);
  assert.equal(entity.kind, "event");
  assert.equal(entity.id, "snapshot-no-artist");
  assert.equal(entity.path, path);
  assert.equal(entity.publicEventSnapshot, true);
  assert.equal(entity.artistKey, null);
  assert.equal(entity.artistIdentityPending, false);
  assert.equal(entity.artist, "Club 1BD");
  assert.equal(entity.eventName, "Club 1BD: Toronto");
  assert.equal(entity.eventKind, "concert");
  assert.equal(entity.venue, "History");
  assert.equal(entity.source, "ticketmaster");
  assert.equal(entity.providerVenueId, "venue-history");
  assert.equal(entity.startLocalTime, "20:00:00");
  assert.equal(entity.ticketUrl, "https://www.ticketmaster.ca/event/fixture");
  assert.equal(Object.hasOwn(entity, "ownerId"), false);
  assert.equal(Object.hasOwn(entity, "owner_id"), false);
  assert.equal(Object.hasOwn(entity, "canInteract"), false);
});

test("pending or conflicting event identities keep exact show details without a namesake link", () => {
  const key = "snapshot-unrelated-namesake";
  const name = "Snapshot Unrelated Namesake";
  const mbid = "82345678-1234-4234-8234-123456789abc";
  addArtist(key, name, mbid);
  addMemorial(key, name, mbid, "1960-04-02");
  for (const status of ["pending", "conflict"]) {
    const id = `snapshot-${status}-identity`;
    const path = addEvent(id, { artist: name, artistKey: null, billedArtists: [name] });
    db.prepare("UPDATE tour_dates SET artist_identity_status=? WHERE id=?").run(status, id);
    const entity = resolveEntity(path);
    assert.equal(entity?.publicEventSnapshot, true);
    assert.equal(entity.artistIdentityPending, true);
    assert.equal(entity.artistKey, null);
    assert.equal(entity.artist, name);
    assert.equal(entity.venue, "History");
    assert.equal(entity.ticketUrl, "https://www.ticketmaster.ca/event/fixture");
    assert.equal(seoHttpPlan(path).status, 200);
  }
});

test("the snapshot marker is never returned for missing, unreleased, invalid, or restricted events", () => {
  q.insertUser.run("snapshot-banned-owner", "banned@example.com", "Banned owner", "snapshotbanned", "hash", "fan",
    null, null, null, "CA", "#111111", Date.now());
  db.prepare("UPDATE users SET is_banned=1 WHERE id='snapshot-banned-owner'").run();
  const rejected = [
    eventPath("snapshot-missing"),
    addEvent("snapshot-unreleased", { releaseAt: Date.now() + 86_400_000 }),
    addEvent("snapshot-invalid-date", { date: "2036-02-31" }),
    addEvent("snapshot-inactive-provider", { active: 0 }),
    addEvent("snapshot-nonmusic", { musicQualified: 0 }),
    addEvent("snapshot-banned-owner-event", { source: "manual", ownerId: "snapshot-banned-owner" }),
  ];
  for (const path of rejected) assert.equal(resolveEntity(path), null, path);
});

test("snapshot artist display cannot retain a contradictory provider artist binding", () => {
  addArtist("snapshot-sports-punk", "sports.");
  const path = addEvent("snapshot-wrong-billing", {
    name: "JUNGLE - World Tour 2036", artist: "sports.", artistKey: "snapshot-sports-punk",
    billedArtists: ["Jungle", "Sports"],
  });
  const entity = resolveEntity(path);
  assert.equal(entity.publicEventSnapshot, true);
  assert.equal(entity.artist, "Jungle");
  assert.equal(entity.artistKey, null);
  const valid = resolveEntity(addEvent("snapshot-correct-billing", {
    artist: "sports.", artistKey: "snapshot-sports-punk", billedArtists: ["sports."],
  }));
  assert.equal(valid.artistKey, "snapshot-sports-punk");
  assert.equal(valid.artist, "sports.");
});

test("protected legacy artists cannot gain historical or upcoming service access through snapshots", () => {
  const key = "snapshot-protected-legacy";
  const name = "Snapshot Protected Legacy Artist";
  const mbid = "42345678-1234-4234-8234-123456789abc";
  addArtist(key, name, mbid);
  addMemorial(key, name, mbid, "1968-04-02");
  for (const [id, date, artistKey] of [
    ["snapshot-legacy-history", "1967-05-12", key],
    ["snapshot-legacy-future", "2036-05-12", key],
    ["snapshot-legacy-name-only", "1967-05-13", null],
  ]) {
    const path = addEvent(id, { artist: name, artistKey, date, billedArtists: [name] });
    assert.equal(resolveEntity(path), null);
    assert.equal(seoHttpPlan(path).status, 404);
  }
});

test("modern memorial history stays readable, while stale legacy identity cannot block a different artist", () => {
  const modernKey = "snapshot-modern-memorial";
  const modernName = "Snapshot Modern Memorial Artist";
  const modernMbid = "52345678-1234-4234-8234-123456789abc";
  addArtist(modernKey, modernName, modernMbid);
  addMemorial(modernKey, modernName, modernMbid, "2020-05-02");
  const history = addEvent("snapshot-modern-history", {
    artist: modernName, artistKey: modernKey, date: "2019-01-14", billedArtists: [modernName],
  });
  assert.equal(resolveEntity(history).publicEventSnapshot, true);
  const future = addEvent("snapshot-modern-future", {
    artist: modernName, artistKey: modernKey, billedArtists: [modernName],
  });
  assert.equal(resolveEntity(future), null);

  const staleKey = "snapshot-stale-legacy-identity";
  const staleName = "Snapshot Reused Name Artist";
  const oldMbid = "62345678-1234-4234-8234-123456789abc";
  addArtist(staleKey, staleName, oldMbid);
  addMemorial(staleKey, staleName, oldMbid, "1960-05-02");
  db.prepare("UPDATE artists SET mbid=? WHERE norm=?")
    .run("72345678-1234-4234-8234-123456789abc", staleKey);
  const separateArtist = addEvent("snapshot-stale-mbid-event", {
    artist: staleName, artistKey: staleKey, billedArtists: [staleName],
  });
  assert.equal(resolveEntity(separateArtist).publicEventSnapshot, true);
});
