import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const directory = mkdtempSync(join(tmpdir(), "pit-comment-account-erasure-"));
process.env.NODE_ENV = "test";
process.env.PIT_DATA_DIR = directory;
delete process.env.RESEND_API_KEY;
delete process.env.MAIL_FROM;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("Network disabled for comment erasure tests"); };
const { db, q } = await import("./db.js");
const { routes } = await import("./api.js");
const { hashPassword } = await import("./auth.js");
const { reparentRepliesForAccountErasure } = await import("./features/accountPrivacy/commentErasure.js");
after(() => {
  db.close();
  globalThis.fetch = originalFetch;
  rmSync(directory, { recursive: true, force: true });
});

const password = "Comment-erasure-fixture-42";
const passHash = hashPassword(password);
let sequence = 0;
function member() {
  const id = `erasure_member_${++sequence}`;
  q.insertUser.run(id, `${id}@example.test`, id, id, passHash, "fan", null, null, null, "ER", "#123456", Date.now());
  db.prepare("UPDATE users SET email_verified_at=?,age_band='18_plus' WHERE id=?").run(Date.now(), id);
  return q.userById.get(id);
}
function fixture() {
  const owner = member(), erased = member(), author = member(), viewer = member();
  const postId = `erasure_post_${++sequence}`;
  db.prepare("INSERT INTO posts (id,user_id,artist,venue,overall,created_at) VALUES (?,?,'Artist','Venue',4,?)")
    .run(postId, owner.id, Date.now());
  return { owner, erased, author, viewer, postId };
}
function context(user, body = {}, params = {}) {
  return { user, body, params, query: { limit: "400" }, ip: `comment-erasure-${user.id}`, setHeader() {}, clearSession() {} };
}
function comment(state, user, parentId = null) {
  const body = { text: `Fixture comment ${++sequence}`, clientMutationId: `erasure_comment_${sequence}`, parentId };
  const result = routes["POST /api/posts/:id/comments"](context(user, body, { id: state.postId }));
  // Stable ordering also exercises ancestor hydration with a one-comment page.
  db.prepare("UPDATE comments SET created_at=? WHERE id=?").run(sequence, result.id);
  return { ...result, body };
}
function page(state, limit = "400") {
  const ctx = context(state.viewer, {}, { id: state.postId });
  ctx.query.limit = limit;
  return routes["GET /api/posts/:id/comments"](ctx);
}
function like(state, id) {
  return routes["POST /api/posts/:postId/comments/:id/like"](
    context(state.viewer, { liked: true }, { postId: state.postId, id }));
}
function erase(state) {
  return routes["DELETE /api/me"](context(state.erased, { password }));
}
function assertUnavailable(state, id) {
  assert.equal(page(state).comments.find((row) => row.id === id).canLike, false);
  assert.throws(() => like(state, id), (error) => error.status === 404 && error.code === "NOT_FOUND");
}

test("account erasure detaches a surviving reply from an erased root without retaining erased content", async () => {
  const state = fixture();
  const parent = comment(state, state.erased);
  const reply = comment(state, state.author, parent.id);
  assert.equal(page(state).comments.find((row) => row.id === reply.id).canLike, true);
  assert.equal(like(state, reply.id).likes, 1);

  assert.deepEqual(await erase(state), { ok: true });
  assert.equal(q.userById.get(state.erased.id), undefined);
  assert.equal(db.prepare("SELECT 1 FROM comments WHERE id=?").get(parent.id), undefined);
  assert.equal(db.prepare("SELECT parent_id FROM comments WHERE id=?").get(reply.id).parent_id, null);
  const after = page(state);
  assert.equal(after.comments.find((row) => row.id === reply.id).parentId, null);
  assert.equal(after.comments.find((row) => row.id === reply.id).canLike, true);
  assert.equal(like(state, reply.id).likes, 1, "existing likes and idempotent reactions survive");
  assert.equal(JSON.stringify(after).includes(state.erased.id), false);
  assert.equal(JSON.stringify(after).includes(parent.body.text), false);

  const retry = routes["POST /api/posts/:id/comments"](context(state.author, reply.body, { id: state.postId }));
  assert.equal(retry.id, reply.id);
  assert.equal(retry.parentId, null);
  assert.equal(retry.duplicate, true);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM comments c LEFT JOIN comments p ON p.id=c.parent_id
    WHERE c.post_id=? AND c.parent_id IS NOT NULL AND p.id IS NULL`).get(state.postId).n, 0);
});

test("nested replies reconnect through consecutive erased ancestors and preserve surviving authors and branches", async () => {
  const state = fixture();
  const root = comment(state, state.owner);
  const first = comment(state, state.erased, root.id);
  const second = comment(state, state.erased, first.id);
  const middle = comment(state, state.author, second.id);
  const third = comment(state, state.erased, middle.id);
  const branch = comment(state, state.owner, first.id);
  const leaf = comment(state, state.viewer, third.id);
  const unrelated = comment(state, state.author);
  await erase(state);

  const parents = new Map(page(state).comments.map((row) => [row.id, row.parentId]));
  assert.deepEqual(parents, new Map([
    [root.id, null], [middle.id, root.id], [branch.id, root.id], [leaf.id, middle.id], [unrelated.id, null],
  ]));
  for (const id of [middle.id, branch.id, leaf.id]) {
    assert.equal(page(state).comments.find((row) => row.id === id).canLike, true);
    assert.equal(like(state, id).liked, true);
  }
  const paged = page(state, "2").comments;
  assert.equal(paged.find((row) => row.id === leaf.id).parentId, middle.id);
  assert.equal(paged.find((row) => row.id === middle.id).parentId, root.id);
  assert.equal(paged.find((row) => row.id === leaf.id).canLike, true);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("a failure after reply reparenting rolls back ancestry, erasure, and its privacy journal event", async () => {
  const state = fixture();
  const parent = comment(state, state.erased);
  const reply = comment(state, state.author, parent.id);
  db.exec(`CREATE TEMP TRIGGER reject_comment_account_erasure BEFORE DELETE ON users
    WHEN OLD.id='${state.erased.id}' BEGIN SELECT RAISE(ABORT,'injected comment erasure failure'); END;`);
  try { await assert.rejects(erase(state), /injected comment erasure failure/); }
  finally { db.exec("DROP TRIGGER reject_comment_account_erasure"); }
  assert.ok(q.userById.get(state.erased.id));
  assert.equal(db.prepare("SELECT text FROM comments WHERE id=?").get(parent.id).text, parent.body.text);
  assert.equal(db.prepare("SELECT parent_id FROM comments WHERE id=?").get(reply.id).parent_id, parent.id);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM privacy_journal_outbox WHERE subject_id=?").get(state.erased.id).n, 0);
  assert.equal(db.isTransaction, false);
  assert.equal(like(state, reply.id).liked, true);
  await erase(state);
  assert.equal(page(state).comments.find((row) => row.id === reply.id).parentId, null);
});

for (const restriction of ["dormant", "banned", "suspended", "viewer_block", "ancestor_block"]) {
  test(`erasing an intermediate author preserves ${restriction} ancestor restrictions`, async () => {
    const state = fixture();
    const ancestor = comment(state, state.owner);
    const parent = comment(state, state.erased, ancestor.id);
    const reply = comment(state, state.author, parent.id);
    // Use a separate ancestor author so the post remains visible to the viewer.
    const ancestorAuthor = member();
    db.prepare("UPDATE comments SET user_id=? WHERE id=?").run(ancestorAuthor.id, ancestor.id);
    if (restriction.endsWith("block")) {
      const pair = restriction === "viewer_block" ? [state.viewer.id, ancestorAuthor.id] : [ancestorAuthor.id, state.viewer.id];
      db.prepare("INSERT INTO blocks(blocker_id,blocked_id,created_at) VALUES (?,?,?)").run(...pair, Date.now());
    } else {
      const column = { dormant: "dormant_at", banned: "is_banned", suspended: "suspended_until" }[restriction];
      db.prepare(`UPDATE users SET ${column}=? WHERE id=?`).run(restriction === "banned" ? 1 : Date.now() + 60_000, ancestorAuthor.id);
    }
    assertUnavailable(state, reply.id);
    await erase(state);
    assert.equal(db.prepare("SELECT parent_id FROM comments WHERE id=?").get(reply.id).parent_id, ancestor.id);
    assertUnavailable(state, reply.id);
  });
}

for (const malformed of ["missing", "cycle", "cross_post"]) {
  test(`account erasure does not authorize an existing ${malformed} reply ancestry`, async () => {
    const state = fixture();
    const parent = comment(state, state.erased);
    const reply = comment(state, state.author, parent.id);
    if (malformed === "missing") {
      db.prepare("UPDATE comments SET parent_id='missing-comment' WHERE id=?").run(parent.id);
    } else if (malformed === "cycle") {
      db.prepare("UPDATE comments SET parent_id=? WHERE id=?").run(parent.id, parent.id);
    } else {
      const other = fixture();
      const foreign = comment(other, state.erased);
      db.prepare("UPDATE comments SET parent_id=? WHERE id=?").run(foreign.id, parent.id);
    }
    assertUnavailable(state, reply.id);
    await erase(state);
    assertUnavailable(state, reply.id);
  });
}

test("erasure reads each affected thread once as authored comment counts grow", () => {
  const readCounts = [];
  for (const size of [10, 1000]) {
    const state = fixture(), other = fixture(), unrelated = fixture();
    const insert = db.prepare("INSERT INTO comments(id,post_id,user_id,text,parent_id,created_at) VALUES (?,?,?,'Fixture',?,1)");
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const postId of [state.postId, other.postId]) {
        for (let index = 0; index < size; index++) {
          const parentId = `scale_parent_${postId}_${index}`;
          insert.run(parentId, postId, state.erased.id, null);
          insert.run(`scale_reply_${postId}_${index}`, postId, state.author.id, parentId);
        }
      }
      // A busy unrelated post must not become part of the erasure read set.
      for (let index = 0; index < size; index++) {
        insert.run(`scale_unrelated_${unrelated.postId}_${index}`, unrelated.postId, state.author.id, null);
      }
      const reads = [];
      const observedDb = {
        get isTransaction() { return db.isTransaction; },
        prepare(sql) {
          const statement = db.prepare(sql);
          return {
            all(...args) {
              const rows = statement.all(...args);
              reads.push({ rows, plan: db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args) });
              return rows;
            },
            run(...args) { return statement.run(...args); },
          };
        },
      };
      reparentRepliesForAccountErasure(observedDb, state.erased.id);
      readCounts.push(reads.length);
      assert.equal(reads.length, 3, "one authored-comment read and one read per affected post");
      assert.equal(reads.reduce((sum, read) => sum + read.rows.length, 0), 4 * size);
      assert.ok(reads.every((read) => read.rows.every((row) => row.post_id !== unrelated.postId)));
      for (const { plan } of reads) {
        const commentLoops = plan.filter((row) => /\bidx_comments_|\b(?:SCAN|SEARCH) (?:comments|c|parent)\b/u.test(row.detail));
        assert.equal(commentLoops.length, 1, "never nest a thread scan inside an authored-comment loop");
        assert.match(commentLoops[0].detail, /SEARCH .* USING (?:COVERING )?INDEX idx_comments_/u);
      }
      for (const postId of [state.postId, other.postId]) {
        assert.equal(db.prepare("SELECT COUNT(*) n FROM comments WHERE post_id=? AND user_id=? AND parent_id IS NULL")
          .get(postId, state.author.id).n, size, "every retained reply was detached");
      }
    } finally {
      db.exec("ROLLBACK");
    }
  }
  assert.equal(readCounts[0], readCounts[1], "100 times more erased comments must not add thread reads");
});
