import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-feed-artist-slug-"));
process.env.PIT_DATA_DIR = dataDir;

const { db, q } = await import("./db.js");
const { routes } = await import("./api.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

test("feed posts expose only the canonical slug of their bound artist", () => {
  q.insertUser.run("slugowner", "slugowner@example.com", "Slug Owner", "slugowner", "test-hash", "fan", "Toronto", 43.65, -79.38, "SO", "#123456", Date.now());
  db.prepare("INSERT INTO artists (norm,name,public_slug,created_at,updated_at) VALUES (?,?,?,?,?)")
    .run("earl sweatshirt", "Earl Sweatshirt", "earl-sweatshirt", Date.now(), Date.now());
  const insert = db.prepare("INSERT INTO posts (id,user_id,artist,artist_key,venue,overall,created_at) VALUES (?,?,?,?,?,?,?)");
  insert.run("bound_artist_post", "slugowner", "Earl Sweatshirt", "earl sweatshirt", "History", 5, 2);
  insert.run("free_text_artist_post", "slugowner", "Earl Sweatshirt", null, "History", 4, 1);

  const posts = routes["GET /api/feed"]({ user: null, query: { limit: "10" } }).posts;
  assert.equal(posts.find((post) => post.id === "bound_artist_post")?.artistPublicSlug, "earl-sweatshirt");
  assert.equal(posts.find((post) => post.id === "free_text_artist_post")?.artistPublicSlug, null);
});
