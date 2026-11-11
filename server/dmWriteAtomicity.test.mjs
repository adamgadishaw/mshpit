import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pit-dm-atomicity-"));
process.env.PIT_DATA_DIR = directory;
process.env.NODE_ENV = "test";
delete process.env.RESEND_API_KEY;
delete process.env.MAIL_FROM;
const { db, q } = await import("./db.js");
const { routes } = await import("./api.js");
const { createSession, destroySession } = await import("./auth.js");
const { readAuthorizedRequest } = await import("./requestAuthorization.js");
const send = routes["POST /api/dms/:otherId"];
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

let sequence = 0;
function account() {
  const id = `atomic_dm_${++sequence}`;
  q.insertUser.run(id, `${id}@example.test`, id, id, "test-hash", "fan", null, null, null, "AD", "#123456", Date.now());
  db.prepare("UPDATE users SET email_verified_at=?,age_band='18_plus' WHERE id=?").run(Date.now(), id);
  return q.userById.get(id);
}
function pair() {
  const sender = account(), recipient = account();
  db.prepare("INSERT INTO follows(follower_id,followee_id) VALUES(?,?),(?,?)").run(sender.id, recipient.id, recipient.id, sender.id);
  return { sender, recipient };
}
async function context(sender, recipient, mutationId) {
  const { token } = createSession(sender.id);
  const body = { text: "One intentional message", ...(mutationId ? { clientMutationId: mutationId } : {}) };
  const authorized = await readAuthorizedRequest({ token, expectedAccount: sender.id, method: "POST", pathname: `/api/dms/${recipient.id}`, readBody: async () => body });
  return { ...authorized, token, ip: `atomic-${++sequence}`, params: { otherId: recipient.id } };
}
function counts(sender, recipient) {
  return {
    messages: db.prepare("SELECT COUNT(*) n FROM dms WHERE from_id=? AND to_id=?").get(sender.id, recipient.id).n,
    notifications: db.prepare("SELECT COUNT(*) n FROM notifications WHERE actor_id=? AND user_id=? AND type='dm'").get(sender.id, recipient.id).n,
    consent: db.prepare("SELECT COUNT(*) n FROM dm_acceptances WHERE (user_id=? AND other_id=?) OR (user_id=? AND other_id=?)").get(sender.id, recipient.id, recipient.id, sender.id).n,
  };
}
function failNotifications(action) {
  db.exec("CREATE TEMP TRIGGER audit_fail_dm_notification BEFORE INSERT ON notifications WHEN NEW.type='dm' BEGIN SELECT RAISE(ABORT,'synthetic notification failure'); END");
  try { return action(); } finally { db.exec("DROP TRIGGER audit_fail_dm_notification"); }
}

for (const keyed of [true, false]) test(`notification failure rolls back ${keyed ? "keyed" : "unkeyed"} message and consent; retry delivers once`, async () => {
  const { sender, recipient } = pair();
  const ctx = await context(sender, recipient, keyed ? `atomic_retry_${++sequence}` : null);
  failNotifications(() => assert.throws(() => send(ctx), /synthetic notification failure/));
  assert.deepEqual(counts(sender, recipient), { messages: 0, notifications: 0, consent: 0 });
  assert.equal(db.isTransaction, false);
  const result = send(ctx);
  assert.ok(result.id);
  assert.deepEqual(counts(sender, recipient), { messages: 1, notifications: 1, consent: 2 });
  if (keyed) {
    assert.deepEqual(send(ctx), { id: result.id, duplicate: true });
    assert.deepEqual(counts(sender, recipient), { messages: 1, notifications: 1, consent: 2 });
  }
});

test("recipient mute deliberately suppresses notifications without failing delivery or retry", async () => {
  const { sender, recipient } = pair();
  db.prepare("INSERT INTO account_mutes(muter_id,muted_id,created_at) VALUES(?,?,?)").run(recipient.id, sender.id, Date.now());
  const ctx = await context(sender, recipient, `atomic_muted_${++sequence}`);
  const first = failNotifications(() => send(ctx));
  assert.deepEqual(counts(sender, recipient), { messages: 1, notifications: 0, consent: 2 });
  db.prepare("DELETE FROM account_mutes WHERE muter_id=? AND muted_id=?").run(recipient.id, sender.id);
  assert.deepEqual(send(ctx), { id: first.id, duplicate: true });
  assert.deepEqual(counts(sender, recipient), { messages: 1, notifications: 0, consent: 2 });
});

test("a failed later send preserves the previously committed conversation", async () => {
  const { sender, recipient } = pair();
  const first = send(await context(sender, recipient, `atomic_first_${++sequence}`));
  const second = await context(sender, recipient, `atomic_second_${++sequence}`);
  failNotifications(() => assert.throws(() => send(second), /synthetic notification failure/));
  assert.deepEqual(counts(sender, recipient), { messages: 1, notifications: 1, consent: 2 });
  assert.equal(db.prepare("SELECT id FROM dms WHERE from_id=? AND to_id=?").get(sender.id, recipient.id).id, first.id);
});

test("current session is checked after the writer lock and revoked sessions cannot retry a committed send", async () => {
  const { sender, recipient } = pair();
  const ctx = await context(sender, recipient, `atomic_authority_${++sequence}`);
  const guard = ctx.assertCurrentSession;
  let guarded = 0;
  ctx.assertCurrentSession = (options) => { assert.equal(db.isTransaction, true); guarded++; return guard(options); };
  send(ctx);
  destroySession(ctx.token);
  assert.throws(() => send(ctx), error => error.status === 401);
  assert.equal(guarded, 2);
  assert.deepEqual(counts(sender, recipient), { messages: 1, notifications: 1, consent: 2 });
  assert.equal(db.isTransaction, false);
});

test("sender restrictions and bilateral blocks are rechecked for new and duplicate sends", async () => {
  for (const restriction of ["ban", "block"]) {
    for (const alreadySent of [false, true]) {
      const { sender, recipient } = pair();
      const ctx = await context(sender, recipient, `atomic_restriction_${++sequence}`);
      if (alreadySent) send(ctx);
      if (restriction === "ban") db.prepare("UPDATE users SET is_banned=1 WHERE id=?").run(sender.id);
      else db.prepare("INSERT INTO blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)").run(recipient.id, sender.id, Date.now());
      assert.throws(() => send(ctx), error => error.status === 403);
      assert.deepEqual(counts(sender, recipient), alreadySent
        ? { messages: 1, notifications: 1, consent: 2 } : { messages: 0, notifications: 0, consent: 0 });
    }
  }
});

test("retry tokens remain bound to the recipient and content inside the transaction", async () => {
  const { sender, recipient } = pair();
  const alternate = account();
  const ctx = await context(sender, recipient, `atomic_binding_${++sequence}`);
  send(ctx);
  assert.throws(() => send({ ...ctx, body: { ...ctx.body, text: "Changed intent" } }), error => error.status === 409);
  assert.throws(() => send({ ...ctx, params: { otherId: alternate.id } }), error => error.status === 409);
  assert.deepEqual(counts(sender, recipient), { messages: 1, notifications: 1, consent: 2 });
  assert.deepEqual(counts(sender, alternate), { messages: 0, notifications: 0, consent: 0 });
  assert.equal(db.isTransaction, false);
});
