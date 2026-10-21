import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import test, { after, beforeEach } from "node:test";

const server = dirname(fileURLToPath(import.meta.url));
const dataDir = mkdtempSync(join(tmpdir(), "pit-discovery-artist-photos-"));
process.env.PIT_DATA_DIR = dataDir;
process.env.NODE_ENV = "test";
process.env.PIT_ENV = "production";
process.env.PIT_ALLOW_EMPTY_DB_BOOTSTRAP = "false";
delete process.env.RENDER;
delete process.env.RESEND_API_KEY;
delete process.env.MAIL_FROM;
const realNow = Date.now, realFetch = globalThis.fetch;
const AT = Date.parse("2099-06-15T12:00:00Z");
let networkCalls = 0;
Date.now = () => AT;
globalThis.fetch = async () => {
  networkCalls += 1;
  throw new Error("Network is unavailable in the discovery artist-photo fixture");
};
const fromServer = (name) => import(pathToFileURL(join(server, name)));
const { db, q } = await fromServer("db.js");
const { routes } = await fromServer("api.js");
const { resetRateLimitsForTests } = await fromServer("auth.js");
const { createTourDateArtistPhotoReader } = await fromServer("tourDateArtistPhotos.js");
const sidebar = routes["GET /api/discovery/sidebar"];
const tourDates = routes["GET /api/tourdates"];
const photo = { uri: "https://cdn-images.dzcdn.net/images/artist/publicfixture/1000x1000-000000-80-0-0.jpg", credit: "Deezer" };
const viewerId = "discovery_artist_photo_viewer";
q.insertUser.run(viewerId, "image-fixture@example.invalid", viewerId, viewerId, "fixture-hash", "fan",
  "Photo City", 45, -75, "PF", "#123456", AT);
const viewer = q.userById.get(viewerId);
const query = (extra = {}) => ({ days: "30", limit: "1", city: "Photo City", country: "ZZ", ...extra });
const context = (requestQuery = {}) => ({ user: viewer, query: requestQuery,
  assertCurrentSession: () => q.userById.get(viewerId) });
const rows = (response) => response.upcomingEvents;

function artist(suffix, { uri = photo.uri, credit = "Deezer", hidden = false } = {}) {
  const name = `Image Fixture ${suffix}`, key = name.toLowerCase();
  db.prepare("INSERT INTO artists(norm,name,photo,data,source,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
    .run(key, name, uri, JSON.stringify({ photoCredit: credit }), null, AT, AT);
  if (hidden) db.prepare("INSERT INTO artist_profiles(artist_key,removed,updated_at) VALUES (?,1,?)").run(key, AT);
  return { key, name };
}
function event(id, boundArtist, day = 1) {
  const date = new Date(AT + day * 86_400_000).toISOString().slice(0, 10);
  db.prepare(`INSERT INTO tour_dates (
    id,artist,artist_key,venue,place,lat,lng,date,source,updated_at,release_at,
    venue_city,venue_region,venue_country_code,venue_country,music_qualified,
    provider_active,event_kind,event_timezone,event_status
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, boundArtist?.name || "Image Fixture Unknown", boundArtist?.key || null,
    "Photo Hall", "Photo City, Photo Region, Photo Country", 45, -75, date,
    "ticketmaster", AT, 0, "Photo City", "Photo Region", "ZZ", "Photo Country",
    1, 1, "concert", "UTC", "scheduled",
  );
}

beforeEach(() => {
  Date.now = () => AT;
  resetRateLimitsForTests();
  db.prepare("DELETE FROM tour_dates").run();
  db.prepare("DELETE FROM artist_profiles WHERE artist_key LIKE 'image fixture %'").run();
  db.prepare("DELETE FROM artists WHERE norm LIKE 'image fixture %'").run();
});
after(() => {
  Date.now = realNow;
  globalThis.fetch = realFetch;
  db.close();
  assert.equal(dirname(resolve(dataDir)), resolve(tmpdir()), "remove only the direct temporary fixture directory");
  assert.ok(dataDir.includes("pit-discovery-artist-photos-"));
  rmSync(dataDir, { recursive: true, force: true });
  assert.equal(networkCalls, 0, "the public projection must not fetch artwork");
});

test("local sidebar retains the bound artist's credited photo", async () => {
  const known = artist("Credited");
  event("photo_known_a", known, 1); event("photo_known_b", known, 2);
  const worldwide = await tourDates(context(query({ limit: "10" })));
  assert.equal(worldwide.tourDates.length, 2);
  for (const row of worldwide.tourDates) assert.deepEqual(row.artistPhoto, photo, "the existing public reader supplies the control image");

  const legacy = await sidebar(context());
  assert.equal(rows(legacy).length, 2);
  for (const row of rows(legacy)) assert.deepEqual(row.artistPhoto, photo, "legacy local rows need the same photo contract");

});

test("sidebar uses existing reader eligibility and leaves truly unavailable artwork absent", async () => {
  const known = artist("Eligible"), hidden = artist("Hidden", { hidden: true });
  const uncredited = artist("Uncredited", { credit: "Spotify" });
  const wrongHost = artist("Wrong Host", { uri: "https://images.example.invalid/not-deezer.jpg" });
  for (const [id, bound] of [["elig_known", known], ["elig_hidden", hidden], ["elig_uncredited", uncredited], ["elig_wrong_host", wrongHost], ["elig_unknown", null]]) event(id, bound);
  const reader = createTourDateArtistPhotoReader(db);
  const control = reader([{ id: "elig_known", artistKey: known.key }, { id: "elig_hidden", artistKey: hidden.key },
    { id: "elig_uncredited", artistKey: uncredited.key }, { id: "elig_wrong_host", artistKey: wrongHost.key }, { id: "elig_unknown", artistKey: null }]);
  assert.deepEqual(control[0].artistPhoto, photo);
  for (const row of control.slice(1)) assert.equal(row.artistPhoto, undefined, row.id);

  for (const response of [await sidebar(context()), await sidebar(context(query({ limit: "20" })))]) {
    const received = new Map(rows(response).map((row) => [row.id, row]));
    assert.deepEqual(received.get("elig_known")?.artistPhoto, photo);
    assert.ok(received.has("elig_unknown"), "an event without artwork stays available");
    for (const id of ["elig_hidden", "elig_uncredited", "elig_wrong_host", "elig_unknown"]) {
      assert.equal(received.get(id)?.artistPhoto, undefined, id);
    }
  }
});

test("sidebar preserves order and event fields without borrowing pending or conflicting artwork", async () => {
  const known = artist("Identity");
  event("identity_clear", known, 1);
  event("identity_pending", known, 2);
  event("identity_conflict", known, 3);
  for (const status of ["pending", "conflict"]) {
    db.prepare("UPDATE tour_dates SET artist_identity_status=? WHERE id=?").run(status, `identity_${status}`);
  }
  const stripPhoto = ({ artistPhoto, ...row }) => row;
  const before = await sidebar(context());
  assert.deepEqual(rows(before).map((row) => row.id), ["identity_clear", "identity_pending", "identity_conflict"]);
  assert.deepEqual(rows(before)[0].artistPhoto, photo);
  for (const row of rows(before).slice(1)) {
    assert.equal(row.artistKey, null);
    assert.equal(row.artistIdentityPending, true);
    assert.equal(row.artistPhoto, undefined, "an unresolved provider identity cannot borrow catalog artwork");
  }
  db.prepare("UPDATE artists SET data='{}' WHERE norm=?").run(known.key);
  const withoutArtwork = await sidebar(context());
  assert.deepEqual(rows(before).map(stripPhoto), rows(withoutArtwork), "artwork leaves event order, counts and every other event field intact");
  assert.deepEqual({ ...before, upcomingEvents: [] }, { ...withoutArtwork, upcomingEvents: [] }, "artwork does not change sidebar aggregates");
});

