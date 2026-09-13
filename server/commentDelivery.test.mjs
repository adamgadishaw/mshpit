import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { Worker } from "node:worker_threads";

const dataDir = mkdtempSync(join(tmpdir(), "pit-comment-delivery-"));
process.env.PIT_DATA_DIR = dataDir;
const { db, q } = await import("./db.js");
const { routes } = await import("./api.js");
const { createSession, destroySession } = await import("./auth.js");
const { readAuthorizedRequest } = await import("./requestAuthorization.js");
after(() => { db.close(); rmSync(dataDir, { recursive: true, force: true }); });

let sequence = 0;
function user() {
  const id = `delivery_user_${++sequence}`;
  q.insertUser.run(id, `${id}@example.test`, id, id, "test-hash", "fan", "Toronto", 43.65, -79.38,
    "QA", "#123456", Date.now());
  db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(Date.now(), id);
  return q.userById.get(id);
}
function fixture() {
  const author = user();
  const owner = user();
  const parentAuthor = user();
  const postId = `delivery_post_${sequence}`;
  const parentId = `delivery_parent_${sequence}`;
  db.prepare("INSERT INTO posts(id,user_id,artist,venue,overall,created_at) VALUES(?,?,?,?,?,?)")
    .run(postId, owner.id, "Artist", "Venue", 4, Date.now());
  db.prepare("INSERT INTO comments(id,post_id,user_id,text,created_at) VALUES(?,?,?,?,?)")
    .run(parentId, postId, parentAuthor.id, "Parent", Date.now());
  return { author, owner, parentAuthor, postId, parentId,
    ctx: { user: author, params: { id: postId }, body: { text: "A reply", parentId, clientMutationId: `delivery_retry_${sequence}` } } };
}
const send = (ctx) => routes["POST /api/posts/:id/comments"](ctx);
const count = (table, column, value) => db.prepare(`SELECT COUNT(*) count FROM ${table} WHERE ${column}=?`).get(value).count;

test("lost-response replay returns one comment and does not repeat either notification", () => {
  const f = fixture();
  const first = send(f.ctx);
  const replay = send(f.ctx);
  assert.deepEqual(replay, { id: first.id, parentId: f.parentId, commentCount: 2, duplicate: true });
  assert.equal(count("comments", "user_id", f.author.id), 1);
  assert.equal(count("notifications", "actor_id", f.author.id), 2);
  const stored = db.prepare("SELECT client_mutation_id,client_mutation_hash FROM comments WHERE id=?").get(first.id);
  assert.equal(stored.client_mutation_id, f.ctx.body.clientMutationId);
  assert.match(stored.client_mutation_hash, /^[a-f0-9]{64}$/);
});

test("first and replay responses carry the current canonical active-comment count", () => {
  const f = fixture();
  for (const restriction of ["removed", "banned", "suspended", "dormant"]) {
    const author = user();
    db.prepare("INSERT INTO comments(id,post_id,user_id,text,created_at) VALUES(?,?,?,?,?)")
      .run(`excluded_${author.id}`, f.postId, author.id, "Not counted", Date.now());
    if (restriction === "removed") db.prepare("UPDATE comments SET removed=1 WHERE user_id=?").run(author.id);
    if (restriction === "banned") db.prepare("UPDATE users SET is_banned=1 WHERE id=?").run(author.id);
    if (restriction === "suspended") db.prepare("UPDATE users SET suspended_until=? WHERE id=?").run(Date.now() + 60_000, author.id);
    if (restriction === "dormant") db.prepare("UPDATE users SET dormant_at=? WHERE id=?").run(Date.now(), author.id);
  }
  const first = send(f.ctx);
  assert.equal(first.commentCount, 2, "only the active parent and new comment count");
  const canonical = routes["GET /api/posts/:id"]({ user: f.author, params: { id: f.postId } });
  assert.equal(first.commentCount, canonical.post.comments);
  const later = user();
  db.prepare("INSERT INTO comments(id,post_id,user_id,text,created_at) VALUES(?,?,?,?,?)")
    .run(`later_${later.id}`, f.postId, later.id, "Later comment", Date.now());
  assert.equal(send(f.ctx).commentCount, 3, "replay returns the live aggregate rather than a stale receipt count");
  assert.equal(count("comments", "user_id", f.author.id), 1);
});

test("same canonical text, optional parent and trimmed key replay the original result", () => {
  const f = fixture();
  const ctx = { ...f.ctx, body: { text: "  Same text  ", clientMutationId: ` ${f.ctx.body.clientMutationId} ` } };
  const first = send(ctx);
  assert.deepEqual(send({ ...ctx, body: { text: "Same text", parentId: null, clientMutationId: f.ctx.body.clientMutationId } }),
    { id: first.id, parentId: null, commentCount: 2, duplicate: true });
});

test("a key cannot discard changed text, target post, or requested reply parent", () => {
  const f = fixture();
  const first = send(f.ctx);
  const other = fixture();
  for (const ctx of [
    { ...f.ctx, body: { ...f.ctx.body, text: "Changed text" } },
    { ...f.ctx, params: { id: other.postId } },
    { ...f.ctx, body: { ...f.ctx.body, parentId: null } },
    { ...f.ctx, body: { ...f.ctx.body, parentId: "missing_parent" } },
  ]) assert.throws(() => send(ctx), (error) => error.status === 409 && error.code === "IDEMPOTENCY_MISMATCH");
  assert.equal(count("comments", "user_id", f.author.id), 1);
  assert.equal(count("notifications", "actor_id", f.author.id), 2);
  assert.equal(db.prepare("SELECT text FROM comments WHERE id=?").get(first.id).text, "A reply");
});

test("mutation keys are account scoped and cannot replay another author's comment", () => {
  const f = fixture();
  const first = send(f.ctx);
  const second = send({ ...f.ctx, user: f.owner });
  assert.notEqual(second.id, first.id);
  assert.equal(second.duplicate, undefined);
  assert.equal(db.prepare("SELECT user_id FROM comments WHERE id=?").get(second.id).user_id, f.owner.id);
});

test("legacy comments without a key remain separate intentional submissions", () => {
  const f = fixture();
  const ctx = { ...f.ctx, body: { text: "Legacy reply", parentId: f.parentId } };
  assert.notEqual(send(ctx).id, send(ctx).id);
  assert.equal(count("comments", "user_id", f.author.id), 2);
});

test("invalid retry identifiers are rejected before any comment or notification write", () => {
  const f = fixture();
  for (const key of [true, 123, {}, [], "tiny", "has a space", "x".repeat(101)]) {
    assert.throws(() => send({ ...f.ctx, body: { ...f.ctx.body, clientMutationId: key } }),
      (error) => error.status === 400 && error.code === "VALIDATION_FAILED");
  }
  assert.equal(count("comments", "user_id", f.author.id), 0);
  assert.equal(count("notifications", "actor_id", f.author.id), 0);
});

test("author and moderator removals retain retry identity and never resurrect a comment", () => {
  for (const removal of ["author", "moderator"]) {
    const f = fixture();
    const first = send(f.ctx);
    if (removal === "author") routes["DELETE /api/posts/:postId/comments/:id"]({ user: f.author, params: { postId: f.postId, id: first.id } });
    else db.prepare("UPDATE comments SET removed=1 WHERE id=?").run(first.id);
    assert.throws(() => send(f.ctx), (error) => error.status === 409 && error.code === "CONFLICT");
    assert.equal(count("comments", "user_id", f.author.id), 1);
    assert.equal(count("notifications", "actor_id", f.author.id), 2);
  }
});

for (const restriction of ["post_removed", "author_banned", "author_dormant", "owner_blocks", "parent_blocks"]) {
  test(`a replay does not bypass ${restriction} visibility`, () => {
    const f = fixture();
    send(f.ctx);
    if (restriction === "post_removed") db.prepare("UPDATE posts SET removed=1 WHERE id=?").run(f.postId);
    if (restriction === "author_banned") db.prepare("UPDATE users SET is_banned=1 WHERE id=?").run(f.owner.id);
    if (restriction === "author_dormant") db.prepare("UPDATE users SET dormant_at=? WHERE id=?").run(Date.now(), f.owner.id);
    if (restriction.endsWith("blocks")) db.prepare("INSERT INTO blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)")
      .run(restriction === "parent_blocks" ? f.parentAuthor.id : f.owner.id, f.author.id, Date.now());
    assert.throws(() => send(f.ctx), (error) => [403, 404].includes(error.status));
    assert.equal(count("comments", "user_id", f.author.id), 1);
    assert.equal(count("notifications", "actor_id", f.author.id), 2);
  });
}

test("replay requires live authentication even when the caller knows a valid key", () => {
  const f = fixture();
  send(f.ctx);
  assert.throws(() => send({ ...f.ctx, user: null }), (error) => error.status === 401);
  assert.throws(() => send({ ...f.ctx, assertCurrentSession() { throw Object.assign(new Error("Revoked"), { status: 401 }); } }),
    (error) => error.status === 401);
  assert.throws(() => send({ ...f.ctx, user: { ...f.author, is_banned: 1 } }), (error) => error.status === 403);
  assert.equal(count("comments", "user_id", f.author.id), 1);
});

test("real session revalidation rejects replay after revocation or account restrictions", async () => {
  for (const mode of ["logout", "expiry", "unverified", "dormant", "banned", "suspended"]) {
    const f = fixture();
    send(f.ctx);
    const session = createSession(f.author.id);
    const authorized = await readAuthorizedRequest({ token: session.token, expectedAccount: f.author.id,
      method: "POST", pathname: `/api/posts/${f.postId}/comments`, readBody: async () => f.ctx.body });
    if (mode === "logout") destroySession(session.token);
    if (mode === "expiry") db.prepare("UPDATE sessions SET expires_at=0 WHERE user_id=?").run(f.author.id);
    if (mode === "unverified") db.prepare("UPDATE users SET email_verified_at=0 WHERE id=?").run(f.author.id);
    if (mode === "dormant") db.prepare("UPDATE users SET dormant_at=? WHERE id=?").run(Date.now(), f.author.id);
    if (mode === "banned") db.prepare("UPDATE users SET is_banned=1 WHERE id=?").run(f.author.id);
    if (mode === "suspended") db.prepare("UPDATE users SET suspended_until=? WHERE id=?").run(Date.now() + 60_000, f.author.id);
    assert.throws(() => send({ ...authorized, params: f.ctx.params }),
      (error) => ["AUTH_REQUIRED", "EMAIL_VERIFICATION_REQUIRED", "FORBIDDEN"].includes(error.code), mode);
    assert.equal(count("comments", "user_id", f.author.id), 1);
    assert.equal(count("notifications", "actor_id", f.author.id), 2);
  }
});

test("comment read projections never expose retry keys or payload hashes", () => {
  const f = fixture();
  const first = send(f.ctx);
  const result = routes["GET /api/posts/:id/comments"]({ user: f.owner, params: { id: f.postId } });
  const comment = result.comments.find((row) => row.id === first.id);
  assert.ok(comment);
  assert.equal(Object.keys(comment).some((key) => /mutation|hash/i.test(key)), false);
  assert.equal(JSON.stringify(result).includes(f.ctx.body.clientMutationId), false);
});

test("deleted or newly appearing parent does not change the original accepted reply binding", () => {
  const f = fixture();
  const first = send(f.ctx);
  db.prepare("UPDATE comments SET removed=1 WHERE id=?").run(f.parentId);
  assert.deepEqual(send(f.ctx), { id: first.id, parentId: f.parentId, commentCount: 1, duplicate: true });
  db.prepare("INSERT INTO blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)").run(f.parentAuthor.id, f.author.id, Date.now());
  assert.throws(() => send(f.ctx), (error) => error.status === 403, "a removed parent's block still applies to its replay");

  const g = fixture();
  const requestedParent = `future_parent_${sequence}`;
  const ctx = { ...g.ctx, body: { ...g.ctx.body, parentId: requestedParent } };
  const accepted = send(ctx);
  assert.equal(accepted.parentId, null);
  db.prepare("INSERT INTO comments(id,post_id,user_id,text,created_at) VALUES(?,?,?,?,?)")
    .run(requestedParent, g.postId, g.parentAuthor.id, "Later parent", Date.now());
  assert.deepEqual(send(ctx), { id: accepted.id, parentId: null, commentCount: 3, duplicate: true });
});

test("notification failure rolls back the retry key, comment and first notification together", () => {
  const f = fixture();
  db.exec(`CREATE TEMP TRIGGER fail_comment_delivery BEFORE INSERT ON notifications
    WHEN NEW.user_id='${f.parentAuthor.id}' BEGIN SELECT RAISE(ABORT,'injected notification failure'); END`);
  try {
    assert.throws(() => send(f.ctx), /injected notification failure/);
    assert.equal(count("comments", "user_id", f.author.id), 0);
    assert.equal(count("notifications", "actor_id", f.author.id), 0);
  } finally { db.exec("DROP TRIGGER fail_comment_delivery"); }
  const first = send(f.ctx);
  assert.deepEqual(send(f.ctx), { id: first.id, parentId: f.parentId, commentCount: 2, duplicate: true });
  assert.equal(count("notifications", "actor_id", f.author.id), 2);
});

test("receipt metadata is fixed-size, survives age/soft deletion, and cascades with its comment lifecycle", () => {
  const f = fixture();
  const first = send(f.ctx);
  db.prepare("UPDATE comments SET created_at=1 WHERE id=?").run(first.id);
  assert.equal(send(f.ctx).id, first.id, "time cannot silently make a previously used key publish again");
  const columns = db.prepare("PRAGMA table_info(comments)").all().filter((column) => column.name.startsWith("client_mutation_"));
  assert.deepEqual(columns.map((column) => column.name).sort(), ["client_mutation_hash", "client_mutation_id"]);
  assert.throws(() => db.prepare("UPDATE comments SET client_mutation_id=? WHERE id=?").run("x".repeat(101), first.id), /CHECK constraint/);
  db.prepare("DELETE FROM users WHERE id=?").run(f.author.id);
  assert.equal(db.prepare("SELECT id FROM comments WHERE id=?").get(first.id), undefined);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("two independent SQLite writers racing the same comment key commit once", { timeout: 20_000 }, async () => {
  const f = fixture();
  const workerSource = `
    const { parentPort, workerData } = require('node:worker_threads');
    (async () => {
      process.env.PIT_DATA_DIR = workerData.dataDir;
      globalThis.fetch = async () => { throw new Error('Provider network disabled in comment fixture'); };
      const { db, q } = await import(workerData.dbUrl);
      const { routes } = await import(workerData.apiUrl);
      parentPort.postMessage({ kind: 'ready' });
      parentPort.once('message', () => {
        parentPort.postMessage({ kind: 'attempting' });
        try {
          const result = routes['POST /api/posts/:id/comments']({ ...workerData.ctx, user: q.userById.get(workerData.authorId) });
          parentPort.postMessage({ kind: 'result', result });
        } catch (error) { parentPort.postMessage({ kind: 'failure', message: error.message }); }
        finally { db.close(); parentPort.close(); }
      });
    })().catch((error) => { parentPort.postMessage({ kind: 'failure', message: error.message }); parentPort.close(); });
  `;
  const workers = [];
  const waitFor = (worker, kind) => new Promise((resolve, reject) => {
    const onError = (error) => { worker.off("message", onMessage); reject(error); };
    const onMessage = (message) => {
      if (message.kind === "failure") { worker.off("message", onMessage); worker.off("error", onError); reject(new Error(message.message)); }
      else if (message.kind === kind) { worker.off("message", onMessage); worker.off("error", onError); resolve(message.result); }
    };
    worker.on("message", onMessage);
    worker.once("error", onError);
  });
  try {
    // The test races comment writes, not unrelated catalog startup maintenance.
    for (let index = 0; index < 2; index++) {
      const worker = new Worker(workerSource, { eval: true, workerData: {
        dataDir, dbUrl: new URL("./db.js", import.meta.url).href, apiUrl: new URL("./api.js", import.meta.url).href,
        ctx: { params: f.ctx.params, body: f.ctx.body }, authorId: f.author.id,
      } });
      workers.push(worker);
      await waitFor(worker, "ready");
    }
    const attempting = Promise.all(workers.map((worker) => waitFor(worker, "attempting")));
    const results = Promise.all(workers.map((worker) => waitFor(worker, "result")));
    db.exec("BEGIN IMMEDIATE");
    for (const worker of workers) worker.postMessage("send");
    await attempting;
    db.exec("COMMIT");
    const responses = await results;
    assert.equal(responses[0].id, responses[1].id);
    assert.equal(responses.filter((result) => result.duplicate).length, 1);
    assert.equal(count("comments", "user_id", f.author.id), 1);
    assert.equal(count("notifications", "actor_id", f.author.id), 2);
  } finally {
    if (db.isTransaction) db.exec("ROLLBACK");
    await Promise.all(workers.map((worker) => worker.terminate()));
  }
});
