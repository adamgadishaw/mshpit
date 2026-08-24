import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-profile-history-"));
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

function addPost(authorId, id, createdAt, { removed = false } = {}) {
  db.prepare(`INSERT INTO posts
    (id,user_id,artist,venue,date,overall,review,photos_public,removed,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, authorId, "History Act", "History Hall", "2026-01-01", 4, id, 1, removed ? 1 : 0, createdAt);
}

test("user post history cursor pages use the deterministic created_at and id tuple", () => {
  const author = addUser("historyauthor");
  const viewer = addUser("historyviewer");
  addPost(author.id, "history-a", 300);
  addPost(author.id, "history-c", 200);
  addPost(author.id, "history-b", 200);
  addPost(author.id, "history-z", 100);
  addPost(author.id, "history-removed", 400, { removed: true });

  const handler = routes["GET /api/users/:id/posts"];
  const first = handler({ user: viewer, params: { id: author.id }, query: { limit: "2" } });
  assert.deepEqual(first.posts.map(({ id }) => id), ["history-a", "history-c"]);
  assert.equal(typeof first.nextCursor, "string");

  const second = handler({ user: viewer, params: { id: author.id }, query: { limit: "2", before: first.nextCursor } });
  assert.deepEqual(second.posts.map(({ id }) => id), ["history-b", "history-z"]);
  assert.equal(second.nextCursor, null);
  assert.deepEqual(new Set([...first.posts, ...second.posts].map(({ id }) => id)).size, 4);

  assert.throws(
    () => handler({ user: viewer, params: { id: author.id }, query: { before: "not-a-cursor" } }),
    (error) => error instanceof ApiError && error.status === 400,
  );
});

test("profile history keeps the existing two-way block and active-account boundary", () => {
  const author = addUser("historyblockedauthor");
  const viewer = addUser("historyblockedviewer");
  addPost(author.id, "history-blocked-post", 1);
  const handler = routes["GET /api/users/:id/posts"];
  db.prepare("INSERT INTO blocks (blocker_id,blocked_id,created_at) VALUES (?,?,?)").run(author.id, viewer.id, Date.now());
  assert.throws(
    () => handler({ user: viewer, params: { id: author.id }, query: {} }),
    (error) => error instanceof ApiError && error.status === 404,
  );
  db.prepare("DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?").run(author.id, viewer.id);
  db.prepare("UPDATE users SET is_banned=1 WHERE id=?").run(author.id);
  assert.throws(
    () => handler({ user: viewer, params: { id: author.id }, query: {} }),
    (error) => error instanceof ApiError && error.status === 404,
  );
});

test("legacy profile clients without pagination parameters still receive up to 100 posts", () => {
  const author = addUser("historylegacyauthor");
  const viewer = addUser("historylegacyviewer");
  for (let index = 0; index < 105; index += 1) {
    addPost(author.id, `history-legacy-${String(index).padStart(3, "0")}`, 1_000 - index);
  }

  const result = routes["GET /api/users/:id/posts"]({
    user: viewer,
    params: { id: author.id },
    query: {},
  });
  assert.equal(result.posts.length, 100);
  assert.equal(typeof result.nextCursor, "string");

  const explicitDefault = routes["GET /api/users/:id/posts"]({
    user: viewer,
    params: { id: author.id },
    query: { limit: "30" },
  });
  assert.equal(explicitDefault.posts.length, 30);

  const explicitCapped = routes["GET /api/users/:id/posts"]({
    user: viewer,
    params: { id: author.id },
    query: { limit: "99" },
  });
  assert.equal(explicitCapped.posts.length, 50);
});
