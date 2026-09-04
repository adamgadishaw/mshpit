import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-artist-archive-"));
const previousDataDir = process.env.PIT_DATA_DIR;
process.env.PIT_DATA_DIR = dataDir;

const { db, q } = await import("../../db.js");
const { routes } = await import("../../api.js");

after(() => {
  db.close();
  if (previousDataDir === undefined) delete process.env.PIT_DATA_DIR;
  else process.env.PIT_DATA_DIR = previousDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

function account(id) {
  q.insertUser.run(
    id,
    `${id}@example.com`,
    id,
    `Name ${id}`,
    "test-hash",
    "fan",
    "Toronto",
    43.65,
    -79.38,
    id.slice(0, 2).toUpperCase(),
    "#123456",
    Date.now(),
  );
  return q.userById.get(id);
}

function post({
  id,
  userId,
  overall,
  photosPublic,
  createdAt,
  venue = "History Hall",
  venueKey = null,
  city = "New York",
  date = "2024-06-01",
  tour = "Neon World Tour",
}) {
  db.prepare(`INSERT INTO posts
    (id,user_id,artist,artist_key,venue,venue_key,city,date,overall,review,photos,photos_public,tour,kind,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id,
    userId,
    "Alpha",
    "alpha",
    venue,
    venueKey,
    city,
    date,
    overall,
    `Review ${id}`,
    JSON.stringify([`https://media.test/${id}.jpg`]),
    photosPublic ? 1 : 0,
    tour,
    "review",
    createdAt,
  );
}

test("production archive routes aggregate complete history with privacy-safe media and targeted indexes", () => {
  const viewer = account("archive-viewer");
  const publicFan = account("public-fan");
  const privateFan = account("private-fan");
  db.prepare(`INSERT INTO artists (norm,name,created_at,updated_at) VALUES ('alpha','Alpha',?,?)`).run(Date.now(), Date.now());
  post({ id: "public-review", userId: publicFan.id, overall: 4.8, photosPublic: true, createdAt: 2 });
  post({ id: "private-review", userId: privateFan.id, overall: 5, photosPublic: false, createdAt: 3 });
  post({
    id: "whitespace-show-review",
    userId: publicFan.id,
    overall: 4.7,
    photosPublic: true,
    createdAt: 1,
    venue: "History  Hall",
    venueKey: "",
    city: "New  York",
  });
  post({
    id: "punctuation-variant",
    userId: publicFan.id,
    overall: 4.6,
    photosPublic: true,
    createdAt: 4,
    venue: "Arena Two",
    venueKey: "arena-two",
    date: "2024-06-02",
    tour: "NEON-WORLD TOUR",
  });
  db.prepare(`INSERT INTO tour_dates
    (id,artist,venue,place,date,ticket_url,sold_out,source,updated_at)
    VALUES ('tm-world','Alpha','Tokyo Dome','Tokyo, Japan','2030-03-01','https://tickets.test/world',0,'ticketmaster',?)`).run(Date.now());

  const readArchive = routes["GET /api/artists/archive"];
  const response = readArchive({
    user: viewer,
    ip: "127.0.0.1",
    query: { artistKey: "alpha", name: "Alpha" },
  });
  assert.equal(response.archive.shows.length, 2);
  const historyShow = response.archive.shows.find((show) => show.venue === "History Hall");
  assert.equal(historyShow.ratingCount, 2);
  assert.equal(historyShow.cover, null,
    "URL-only historical media cannot become an archive cover without a verified PIT asset");
  assert.equal(response.archive.tours.length, 1, "normalized tour identity prevents punctuation variants from splitting the tour");
  assert.equal(response.archive.tours[0].name, "Neon World Tour", "the cleanest real fan-entered label represents the merged tour");
  assert.equal(response.archive.upcoming[0].venue, "Tokyo Dome");

  const reviewPage = routes["GET /api/artists/archive/reviews"]({
    user: viewer,
    ip: "127.0.0.1",
    query: { artistKey: "alpha", name: "Alpha", showKey: historyShow.key, limit: "1" },
  });
  assert.equal(reviewPage.reviews.length, 1);
  assert.equal(reviewPage.reviews[0].id, "private-review");
  assert.deepEqual(reviewPage.reviews[0].media, []);
  assert.match(reviewPage.nextCursor, /^cursor\./);
  assert.equal(reviewPage.total, 3, "show selection matches the archive's normalized venue identity");

  const tourPage = routes["GET /api/artists/archive/reviews"]({
    user: viewer,
    ip: "127.0.0.1",
    query: { artistKey: "alpha", name: "Alpha", tourKey: response.archive.tours[0].key, limit: "10" },
  });
  assert.deepEqual(tourPage.reviews.map((review) => review.id), ["punctuation-variant", "private-review", "public-review", "whitespace-show-review"]);
  assert.equal(tourPage.total, 4, "normalized SQL filtering returns every label variant in the tour");

  const indexes = new Set(db.prepare("PRAGMA index_list(posts)").all().map((entry) => entry.name));
  assert.equal(indexes.has("idx_posts_artist_archive"), true);
  assert.equal(indexes.has("idx_posts_artist_name_archive"), true);
});

test("archive upcoming dates and totals honor blocks in both directions without weakening staff oversight", () => {
  const viewer = account("archive-block-viewer");
  const owner = account("archive-date-owner");
  const staffAccount = account("archive-date-admin");
  db.prepare("UPDATE users SET role='admin' WHERE id=?").run(staffAccount.id);
  const admin = q.userById.get(staffAccount.id);
  const artistKey = "archive privacy artist";
  const artistName = "Archive Privacy Artist";
  db.prepare("INSERT INTO artists (norm,name,created_at,updated_at) VALUES (?,?,?,?)")
    .run(artistKey, artistName, Date.now(), Date.now());
  const insertDate = db.prepare(`INSERT INTO tour_dates
    (id,artist,venue,place,date,ticket_url,sold_out,source,updated_at,owner_id,release_at)
    VALUES (?,?,?,?,?,?,0,?,?,?,?)`);
  insertDate.run(
    "archive-provider-date",
    artistName,
    "Provider Hall",
    "Berlin, Germany",
    "2030-03-01",
    "https://www.ticketmaster.de/event/provider",
    "ticketmaster",
    Date.now(),
    null,
    0,
  );
  insertDate.run(
    "archive-owned-date",
    artistName,
    "Artist Hall",
    "Tokyo, Japan",
    "2030-03-02",
    "https://tickets.artist.example/show",
    "artist-submitted",
    Date.now(),
    owner.id,
    0,
  );

  const read = (user, ip) => routes["GET /api/artists/archive"]({
    user,
    ip,
    query: { artistKey, name: artistName },
  }).archive;
  const expectVisibleIds = (archive, expected) => {
    assert.deepEqual(archive.upcoming.map((entry) => entry.id), expected);
    assert.equal(archive.totals.upcoming, expected.length);
  };

  expectVisibleIds(read(viewer, "archive-block-before"), ["archive-provider-date", "archive-owned-date"]);

  db.prepare("INSERT INTO blocks (blocker_id,blocked_id,created_at) VALUES (?,?,?)")
    .run(owner.id, viewer.id, Date.now());
  expectVisibleIds(read(viewer, "archive-block-owner-viewer"), ["archive-provider-date"]);
  db.prepare("DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?").run(owner.id, viewer.id);

  db.prepare("INSERT INTO blocks (blocker_id,blocked_id,created_at) VALUES (?,?,?)")
    .run(viewer.id, owner.id, Date.now());
  expectVisibleIds(read(viewer, "archive-block-viewer-owner"), ["archive-provider-date"]);
  db.prepare("DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?").run(viewer.id, owner.id);

  db.prepare("INSERT INTO blocks (blocker_id,blocked_id,created_at) VALUES (?,?,?)")
    .run(owner.id, admin.id, Date.now());
  expectVisibleIds(read(admin, "archive-block-admin"), ["archive-provider-date", "archive-owned-date"]);
});
