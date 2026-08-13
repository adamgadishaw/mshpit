import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-feed-preview-"));
process.env.PIT_DATA_DIR = dataDir;

const { db, q } = await import("./db.js");
const { routes } = await import("./api.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function addUser(id) {
  q.insertUser.run(id, `${id}@example.com`, id, id, "test-hash", "fan", "Toronto", 43.65, -79.38, id.slice(0, 2).toUpperCase(), "#123456", Date.now());
  return q.userById.get(id);
}

test("feed embeds two latest visible comments per post without per-card reads", () => {
  const owner = addUser("previewowner");
  const viewer = addUser("previewviewer");
  const visible = addUser("previewvisible");
  const blocked = addUser("previewblocked");
  db.prepare("INSERT INTO posts (id,user_id,artist,venue,overall,created_at) VALUES (?,?,?,?,?,?)")
    .run("preview_post", owner.id, "Artist", "Venue", 4, 100);
  const insert = db.prepare("INSERT INTO comments (id,post_id,user_id,text,created_at) VALUES (?,?,?,?,?)");
  insert.run("comment_1", "preview_post", visible.id, "old", 101);
  insert.run("comment_2", "preview_post", visible.id, "middle", 102);
  insert.run("comment_3", "preview_post", blocked.id, "hidden", 103);
  insert.run("comment_4", "preview_post", visible.id, "latest", 104);
  db.prepare("INSERT INTO blocks (blocker_id,blocked_id,created_at) VALUES (?,?,?)").run(viewer.id, blocked.id, 105);

  const result = routes["GET /api/feed"]({ user: viewer, query: { limit: "10" } });
  const post = result.posts.find((item) => item.id === "preview_post");
  assert.ok(post);
  assert.deepEqual(post.commentPreview.map((comment) => comment.id), ["comment_2", "comment_4"]);
  assert.ok(post.commentPreview.every((comment) => comment.userId !== blocked.id));
  assert.equal(post.commentPreview[1].text, "latest");
});
