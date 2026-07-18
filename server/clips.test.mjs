import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-clips-"));
process.env.PIT_DATA_DIR = dataDir;

const { db, q } = await import("./db.js");
const { routes } = await import("./api.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function addUser(id, role = "fan") {
  q.insertUser.run(id, `${id}@example.com`, id, id.replace(/[^a-z0-9_]/g, "").slice(0, 20), "test-hash", role, "Toronto", 43.65, -79.38, id.slice(0, 2).toUpperCase(), "#123456", Date.now());
  return q.userById.get(id);
}
function post(user, { photos, photosPublic = 1, artist = "Turnstile" }) {
  return routes["POST /api/posts"]({
    user, ip: "clip-" + user.id,
    body: { artist, venue: "History", city: "Toronto", date: "2026-07-12", overall: 4.5, photos, photosPublic },
  }).post;
}

test("clips reel returns only public posts that carry a real video, with just the clip urls", () => {
  const u = addUser("clipper");
  const V = "https://cdn.example/users/clipper/post/a.webm";
  const V2 = "https://cdn.example/users/clipper/post/b.mp4";
  const IMG = "https://cdn.example/users/clipper/post/c.jpg";

  post(u, { photos: [IMG] });                 // photo-only: excluded
  post(u, { photos: [V, IMG] });              // mixed: included, only the video surfaces
  post(u, { photos: [V2], photosPublic: 0 }); // private video: excluded

  const { clips } = routes["GET /api/clips"]({ user: u, query: {} });
  assert.equal(clips.length, 1, "only the public post with a video is a clip");
  assert.deepEqual(clips[0].clips, [V], "clips array is just the video urls, images stripped");
  assert.equal(clips[0].artist, "Turnstile");
});

test("clips reel paginates newest-first with a stable cursor", () => {
  const u = addUser("clipper2");
  for (let i = 0; i < 3; i++) post(u, { photos: [`https://cdn.example/users/clipper2/post/${i}.mp4`], artist: `Band ${i}` });

  const first = routes["GET /api/clips"]({ user: u, query: { limit: "2" } });
  assert.equal(first.clips.length, 2);
  assert.ok(first.nextCursor, "a full page returns a cursor");
  // Newest first.
  assert.equal(first.clips[0].artist, "Band 2");

  const second = routes["GET /api/clips"]({ user: u, query: { limit: "2", before: first.nextCursor } });
  const ids = new Set(first.clips.map((c) => c.id));
  assert.ok(second.clips.every((c) => !ids.has(c.id)), "the next page never repeats the first");
});
