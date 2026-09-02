import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-post-read-"));
process.env.PIT_DATA_DIR = dataDir;

const { db, q } = await import("./db.js");
const { ApiError, routes } = await import("./api.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function addUser(id) {
  q.insertUser.run(id, `${id}@example.com`, id, id, "test-hash", "fan", "Toronto", 43.65, -79.38, id.slice(0, 2).toUpperCase(), "#123456", Date.now());
  return q.userById.get(id);
}

test("single-post read returns canonical state and hides removed or blocked posts", () => {
  const owner = addUser("readowner");
  const viewer = addUser("readviewer");
  const created = routes["POST /api/posts"]({
    user: owner,
    ip: "post-read-create",
    body: { kind: "status", review: "response-loss reconciliation", photosPublic: false },
  });

  const read = routes["GET /api/posts/:id"]({ user: owner, params: { id: created.id } });
  assert.equal(read.post.id, created.id);
  assert.equal(read.post.review, "response-loss reconciliation");
  assert.equal(read.post.version, created.post.version);

  db.prepare("INSERT INTO blocks (blocker_id,blocked_id,created_at) VALUES (?,?,?)").run(viewer.id, owner.id, Date.now());
  assert.throws(
    () => routes["GET /api/posts/:id"]({ user: viewer, params: { id: created.id } }),
    (error) => error instanceof ApiError && error.status === 404 && error.code === "NOT_FOUND",
  );

  db.prepare("UPDATE posts SET removed=1 WHERE id=?").run(created.id);
  assert.throws(
    () => routes["GET /api/posts/:id"]({ user: owner, params: { id: created.id } }),
    (error) => error instanceof ApiError && error.status === 404 && error.code === "NOT_FOUND",
  );
});

test("status posts do not grant artist-page photo reuse when consent is omitted", () => {
  const owner = addUser("statusprivate");
  const created = routes["POST /api/posts"]({
    user: owner,
    ip: "post-read-private-default",
    body: { kind: "status", review: "A plain status without secondary-use consent" },
  });

  assert.equal(created.post.photosPublic, false);
  assert.equal(
    db.prepare("SELECT photos_public FROM posts WHERE id=?").get(created.id).photos_public,
    0,
  );
});
