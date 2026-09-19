import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { artistAuthoredTourDateVisibleSql } from "./artistAuthoredTourDateVisibility.js";
import { visibleTourDateRowsFrom } from "./tourDateVisibilityQuery.js";

const directory = mkdtempSync(join(tmpdir(), "pit-artist-authored-dates-"));
process.env.PIT_DATA_DIR = directory;
const { db, q } = await import("./db.js");
const { routes } = await import("./api.js");
const { createPublicDocumentRepository } = await import("./features/seo/publicDocumentRepository.js");
const { materializeSitemapCandidates } = await import("./features/seo/sitemapService.js");
const { createEventCoverageService } = await import("./features/discovery/eventCoverageService.js");
const documents = createPublicDocumentRepository(db);
const at = Date.now();
let sequence = 0;
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

function member() {
  const id = `authored_date_${++sequence}`;
  q.insertUser.run(id, `${id}@example.com`, id, id, "fixture-hash", "fan", "Toronto", 43.65, -79.38, "AD", "#123456", at);
  db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(at, id);
  return q.userById.get(id);
}

function published() {
  const owner = member();
  const artist = routes["POST /api/artist-pages"]({ user: owner, ip: owner.id,
    body: { artistName: `Authored Privacy Act ${sequence}` } }).artist;
  const date = new Date(at + 7 * 86_400_000).toISOString().slice(0, 10);
  const result = routes["POST /api/tourdates"]({ user: q.userById.get(owner.id), ip: owner.id,
    body: { dates: [{ venue: `Privacy Hall ${sequence}`, place: "Toronto, Canada", date }] } });
  const id = result.tourDates[0].id;
  db.prepare("UPDATE tour_dates SET venue_city='Toronto',venue_country_code='CA',venue_country='Canada',venue_address_line1='1 Music Street' WHERE id=?").run(id);
  return { owner: q.userById.get(owner.id), artist, id, venue: result.tourDates[0].venue };
}

test("authored shows follow page privacy across member browsing, public events, venues, sitemap and coverage", () => {
  const { owner, artist, id, venue } = published();
  const viewer = member();
  const visible = actor => visibleTourDateRowsFrom(db, actor, { artist: artist.name, at }).some(row => row.id === id);
  assert.equal(visible(null), true);
  assert.ok(documents.readEvent({ id, at }));
  assert.equal(documents.readVenue({ name: venue, at }).events.some(row => row.id === id), true);
  assert.equal(materializeSitemapCandidates(db, { now: at }).tourDates.some(row => row.id === id), true);
  const before = createEventCoverageService({ database: db, clock: () => at }).read().total;
  db.prepare("UPDATE users SET profile_audience='only_me' WHERE id=?").run(owner.id);
  assert.equal(visible(null), false);
  assert.equal(visible(viewer), false);
  assert.equal(visible(owner), true, "private owners retain management preview");
  assert.equal(documents.readEvent({ id, at }), null);
  assert.equal(documents.readVenue({ name: venue, at }).events.some(row => row.id === id), false);
  assert.equal(documents.readDirectory({ kind: "events", at }).events.some(row => row.id === id), false);
  assert.equal(materializeSitemapCandidates(db, { now: at }).tourDates.some(row => row.id === id), false);
  assert.equal(createEventCoverageService({ database: db, clock: () => at }).read().total, before - 1);
  db.prepare("UPDATE users SET profile_audience='members' WHERE id=?").run(owner.id);
  assert.equal(visible(null), false);
  assert.equal(visible(viewer), true);
  db.prepare("INSERT INTO blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)").run(owner.id, viewer.id, at);
  assert.equal(visible(viewer), false);
  db.prepare("UPDATE artist_profiles SET removed=1 WHERE artist_key=?").run(artist.key);
  assert.equal(visible(owner), false, "page removal also withdraws owned calendar entries");
});

test("ownership withdrawal hides authored dates but never hides independently imported provider events", () => {
  const { owner, artist, id } = published();
  db.prepare("UPDATE artist_profiles SET owner_id=NULL WHERE artist_key=?").run(artist.key);
  assert.equal(visibleTourDateRowsFrom(db, null, { id, at }).length, 0);
  db.prepare("UPDATE tour_dates SET owner_id=NULL,source='ticketmaster' WHERE id=?").run(id);
  assert.equal(visibleTourDateRowsFrom(db, null, { id, at }).length, 1,
    "public provider evidence is independent of a member's page privacy");
  assert.equal(q.userById.get(owner.id).verified, 0);
});

test("authored concert SQL accepts only fixed aliases and bound viewer references", () => {
  assert.throws(() => artistAuthoredTourDateVisibleSql("td; DROP TABLE users"), /Invalid/);
  assert.throws(() => artistAuthoredTourDateVisibleSql("td", "'forged' OR 1=1"), /Invalid/);
});
