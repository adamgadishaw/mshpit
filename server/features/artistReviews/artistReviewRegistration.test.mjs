import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-artist-reviews-"));
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

function addAccount(id) {
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

test("production route registration uses canonical post projection and targeted indexes", () => {
  const author = addAccount("review-author");
  const tagged = addAccount("tagged-fan");
  const viewer = addAccount("review-viewer");
  db.prepare(`INSERT INTO posts
    (id,user_id,artist,artist_key,venue,city,date,overall,review,photos,photos_public,tagged_user_ids,song,kind,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    "review-live-route",
    author.id,
    "Alpha",
    "alpha",
    "History",
    "Toronto",
    "2026-07-01",
    5,
    "The room lifted off.",
    JSON.stringify(["https://media.test/private.jpg"]),
    0,
    JSON.stringify([tagged.id]),
    JSON.stringify({ videoId: "youtube-123", title: "Midnight", artist: "Alpha" }),
    "review",
    100,
  );

  const read = routes["GET /api/artists/reviews"];
  assert.equal(typeof read, "function");
  const response = read({
    user: viewer,
    ip: "127.0.0.1",
    query: { artistKey: "alpha", name: "Alpha", limit: "3" },
  });

  assert.equal(response.reviews.length, 1);
  assert.equal(response.reviews[0].id, "review-live-route");
  assert.deepEqual(response.reviews[0].song, {
    videoId: "youtube-123",
    title: "Midnight",
    artist: "Alpha",
  });
  assert.deepEqual(response.reviews[0].taggedPeople.map((person) => person.id), [tagged.id]);
  assert.deepEqual(response.reviews[0].photos, []);
  assert.deepEqual(response.reviews[0].media, []);
  assert.deepEqual(response.reviews[0].mediaAssetIds, []);

  const indexes = new Set(db.prepare("PRAGMA index_list(posts)").all().map((entry) => entry.name));
  assert.equal(indexes.has("idx_posts_artist_reviews"), true);
  assert.equal(indexes.has("idx_posts_artist_name_reviews"), true);
});
