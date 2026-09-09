import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-comment-ancestor-privacy-"));
process.env.PIT_DATA_DIR = dataDir;
const { db, q } = await import("./db.js");
const { routes } = await import("./api.js");

after(() => { db.close(); rmSync(dataDir, { recursive: true, force: true }); });

let sequence = 0;
function user(prefix) {
  const id = `${prefix}_${++sequence}`;
  q.insertUser.run(id, `${id}@example.test`, id, id, "test-hash", "fan", "Toronto", 43.65, -79.38,
    "QA", "#123456", Date.now());
  return q.userById.get(id);
}

function fixture() {
  const owner = user("owner");
  const author = user("author");
  const viewer = user("viewer");
  const postId = `post_${sequence}`;
  const parentId = `parent_${sequence}`;
  const childId = `child_${sequence}`;
  db.prepare("INSERT INTO posts (id,user_id,artist,venue,overall,created_at) VALUES (?,?,?,?,?,?)")
    .run(postId, owner.id, "Artist", "Venue", 4, 100);
  const insert = db.prepare("INSERT INTO comments (id,post_id,user_id,text,parent_id,created_at) VALUES (?,?,?,?,?,?)");
  insert.run(parentId, postId, author.id, "Original ancestor text", null, 101);
  insert.run(childId, postId, owner.id, "Visible reply", parentId, 102);
  return { owner, author, viewer, postId, parentId, childId };
}

function comments(state, viewer, limit = "1") {
  return routes["GET /api/posts/:id/comments"]({ user: viewer, params: { id: state.postId }, query: { limit } }).comments;
}

for (const restriction of ["dormant", "banned", "suspended"]) {
  test(`comment ancestor hydration redacts ${restriction} authors for guests and members`, () => {
    const state = fixture();
    const column = { dormant: "dormant_at", banned: "is_banned", suspended: "suspended_until" }[restriction];
    db.prepare(`UPDATE users SET ${column}=? WHERE id=?`)
      .run(restriction === "banned" ? 1 : Date.now() + 60_000, state.author.id);

    for (const viewer of [null, state.viewer]) {
      for (const limit of ["1", "400"]) {
        const thread = comments(state, viewer, limit);
        assert.deepEqual(thread.find((comment) => comment.id === state.parentId), {
          id: state.parentId, userId: null, name: null, initials: null, avatarUri: null,
          avatarColor: null, role: null, verified: false, text: "", deleted: true,
          parentId: null, createdAt: 101,
        });
        assert.equal(thread.find((comment) => comment.id === state.childId).parentId, state.parentId);
        assert.equal(JSON.stringify(thread).includes(state.author.id), false);
      }
    }
    assert.deepEqual({ ...db.prepare("SELECT text,removed FROM comments WHERE id=?").get(state.parentId) },
      { text: "Original ancestor text", removed: 0 }, "privacy projection must preserve stored user content");
  });
}

test("active ancestors outside the requested page retain their text and reply structure", () => {
  const state = fixture();
  const thread = comments(state, state.viewer);
  const parent = thread.find((comment) => comment.id === state.parentId);
  assert.equal(parent.userId, state.author.id);
  assert.equal(parent.text, "Original ancestor text");
  assert.equal(parent.deleted, false);
  assert.equal(thread.find((comment) => comment.id === state.childId).parentId, parent.id);
});

for (const direction of ["viewer", "author"]) {
  test(`ancestor hydration does not restore a comment blocked by the ${direction}`, () => {
    const state = fixture();
    const [blocker, blocked] = direction === "viewer" ? [state.viewer, state.author] : [state.author, state.viewer];
    db.prepare("INSERT INTO blocks (blocker_id,blocked_id,created_at) VALUES (?,?,?)")
      .run(blocker.id, blocked.id, Date.now());
    const thread = comments(state, state.viewer);
    assert.equal(thread.some((comment) => comment.id === state.parentId), false);
    assert.equal(thread.find((comment) => comment.id === state.childId).text, "Visible reply");
  });
}
