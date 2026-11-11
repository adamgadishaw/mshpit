import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const directory = mkdtempSync(join(tmpdir(), "pit-dm-participant-privacy-"));
process.env.NODE_ENV = "test";
process.env.PIT_DATA_DIR = directory;
process.env.PIT_ALLOW_EMPTY_DB_BOOTSTRAP = "true";
delete process.env.RESEND_API_KEY;
delete process.env.MAIL_FROM;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("Participant privacy tests do not use network access"); };
const { db, q } = await import("./db.js");
const { routes } = await import("./api.js");
const { createSession, destroySession } = await import("./auth.js");
const { readAuthorizedRequest } = await import("./requestAuthorization.js");
after(() => { globalThis.fetch = originalFetch; db.close(); rmSync(directory, { recursive: true, force: true }); });

let sequence = 0;
function member() {
  const id = `dm_participant_privacy_${++sequence}`;
  q.insertUser.run(id, `${id}@example.test`, `Synthetic member ${id}`, id, "unusable-fixture-password-record",
    "fan", null, null, null, "DP", "#123456", Date.now());
  db.prepare("UPDATE users SET email_verified_at=?,age_band='18_plus',bio=?,home_city=?,genres=?,favorite_artists=?,extras=? WHERE id=?")
    .run(Date.now(), "Synthetic biography", "Synthetic city", '["Rock"]', '["Synthetic artist"]',
      JSON.stringify({ pronouns: "they/them", favoriteShows: ["synthetic-show"] }), id);
  return q.userById.get(id);
}
async function context(user, method = "GET", pathname = "/api/me/threads", body = {}, params = {}) {
  const token = user ? createSession(user.id).token : null;
  const authorized = await readAuthorizedRequest({ token, expectedAccount: user?.id, method, pathname, readBody: () => body });
  return { ...authorized, token, params, query: {}, ip: `dm-privacy-test-${++sequence}` };
}
async function inbox(user, summary = true) {
  const ctx = await context(user);
  ctx.query = summary ? { summary: "1" } : {};
  return routes["GET /api/me/threads"](ctx);
}
async function thread(user, peer, summary = true) {
  return (await inbox(user, summary)).threads.find(row => row.otherId === peer.id);
}
function message(sender, recipient, timestamp, suffix = "") {
  const id = `dm_privacy_message_${++sequence}${suffix}`;
  db.prepare("INSERT INTO dms(id,from_id,to_id,text,created_at) VALUES(?,?,?,?,?)")
    .run(id, sender.id, recipient.id, "Synthetic message history", timestamp);
  return id;
}
function unavailable(id) {
  return { id, name: "Unavailable account", handle: "unavailable", initials: "?",
    avatarUri: null, avatarColor: null, profileUpdatedAt: 0, unavailable: true };
}
function historyState(row) {
  const { otherUser, relationshipContext, ...state } = row;
  return state;
}
function minimalVisible(row, peer) {
  assert.deepEqual(Object.keys(row).sort(),
    ["id", "name", "handle", "initials", "avatarUri", "avatarColor", "profileUpdatedAt"].sort());
  assert.equal(row.id, peer.id);
  assert.equal(row.name, peer.name);
  assert.equal(row.handle, peer.handle);
  assert.equal(row.initials, peer.initials);
}

test("both inbox variants keep only display identity and preserve history, tie ordering and removals", async () => {
  const viewer = member(), peer = member(), second = member();
  const older = message(viewer, peer, 10);
  const incoming = message(peer, viewer, 20);
  const removed = message(peer, viewer, 21);
  db.prepare("UPDATE dms SET removed=1 WHERE id=?").run(removed);
  const tied = message(second, viewer, 20);
  const expectedOrder = [{ peer: peer.id, id: incoming }, { peer: second.id, id: tied }]
    .sort((a, b) => b.id.localeCompare(a.id)).map(row => row.peer);
  for (const summary of [true, false]) {
    const result = await inbox(viewer, summary);
    assert.deepEqual(result.threads.map(row => row.otherId), expectedOrder);
    const row = result.threads.find(item => item.otherId === peer.id);
    minimalVisible(row.otherUser, peer);
    assert.deepEqual(row.messages.map(item => item.id), summary ? [incoming] : [older, incoming]);
    assert.equal(row.unread, 1);
    assert.equal(row.requestState, "accepted");
    assert.equal(row.hasReplied, true);
    assert.ok(result.removedIds.includes(removed));
  }
  db.prepare("UPDATE users SET name='Updated visible identity',initials='UV',bio='Updated private biography',home_city='Updated private city',profile_updated_at=42 WHERE id=?")
    .run(peer.id);
  for (const summary of [true, false]) {
    const row = await thread(viewer, peer, summary);
    minimalVisible(row.otherUser, q.userById.get(peer.id));
    assert.equal(row.otherUser.profileUpdatedAt, 42);
  }
});

test("privacy and inactive-state changes replace current identity while preserving readable conversations", async () => {
  const viewer = member(), peer = member();
  message(viewer, peer, 10);
  message(peer, viewer, 20);
  db.prepare("INSERT INTO follows(follower_id,followee_id) VALUES(?,?),(?,?)")
    .run(viewer.id, peer.id, peer.id, viewer.id);
  const before = new Map();
  for (const summary of [true, false]) before.set(summary, historyState(await thread(viewer, peer, summary)));
  for (const [field, value, reset] of [["profile_audience", "only_me", "everyone"], ["is_banned", 1, 0],
    ["dormant_at", Date.now(), null], ["suspended_until", Date.now() + 60_000, null]]) {
    const preparedContexts = await Promise.all([context(viewer), context(viewer)]);
    db.prepare(`UPDATE users SET ${field}=?,name='Inaccessible changed identity',handle=?,initials='XX',bio='Inaccessible changed biography',home_city='Inaccessible changed city',favorite_artists=?,extras=? WHERE id=?`)
      .run(value, `changed_${peer.id}`, '["Changed private artist"]',
        JSON.stringify({ pronouns: "they/them", favoriteShows: ["changed-private-show"] }), peer.id);
    const direct = await context(viewer, "GET", `/api/users/${peer.id}`, {}, { id: peer.id });
    assert.throws(() => routes["GET /api/users/:id"](direct), error => error.status === 404, field);
    for (const [index, summary] of [true, false].entries()) {
      const ctx = preparedContexts[index];
      ctx.query = summary ? { summary: "1" } : {};
      const row = routes["GET /api/me/threads"](ctx).threads.find(item => item.otherId === peer.id);
      assert.deepEqual(row.otherUser, unavailable(peer.id), field);
      assert.deepEqual(historyState(row), before.get(summary), field);
    }
    db.prepare(`UPDATE users SET ${field}=? WHERE id=?`).run(reset, peer.id);
    for (const summary of [true, false]) minimalVisible((await thread(viewer, peer, summary)).otherUser, q.userById.get(peer.id));
  }
  db.prepare("UPDATE users SET profile_audience='members' WHERE id=?").run(peer.id);
  for (const summary of [true, false]) minimalVisible((await thread(viewer, peer, summary)).otherUser, q.userById.get(peer.id));
});

test("private participant placeholders preserve request acceptance, targeted reads and existing replies", async () => {
  const viewer = member(), peer = member();
  const incoming = message(peer, viewer, 10);
  db.prepare("UPDATE users SET profile_audience='only_me',dm_policy='nobody' WHERE id=?").run(peer.id);
  for (const summary of [true, false]) {
    const row = await thread(viewer, peer, summary);
    assert.deepEqual(row.otherUser, unavailable(peer.id));
    assert.equal(row.requestState, "pending");
    assert.equal(row.unread, 1);
  }
  const accepted = routes["POST /api/dms/:otherId/accept"](await context(viewer, "POST", `/api/dms/${peer.id}/accept`, {}, { otherId: peer.id }));
  assert.equal(accepted.requestState, "accepted");
  const read = routes["POST /api/dms/:otherId/read-through"](await context(viewer, "POST", `/api/dms/${peer.id}/read-through`,
    { messageId: incoming }, { otherId: peer.id }));
  assert.equal(read.unread, 0);
  assert.deepEqual(read.readCursor, { createdAt: 10, id: incoming });
  const sent = routes["POST /api/dms/:otherId"](await context(viewer, "POST", `/api/dms/${peer.id}`,
    { text: "Synthetic existing conversation reply", clientMutationId: "participant-privacy-reply" }, { otherId: peer.id }));
  for (const summary of [true, false]) {
    const row = await thread(viewer, peer, summary);
    assert.deepEqual(row.otherUser, unavailable(peer.id));
    assert.equal(row.requestState, "accepted");
    assert.equal(row.hasReplied, true);
    assert.equal(row.unread, 0);
    assert.equal(row.messages.at(-1).id, sent.id);
    assert.deepEqual(row.readCursor, read.readCursor);
  }
  const history = routes["GET /api/dms/:otherId"](await context(viewer, "GET", `/api/dms/${peer.id}`, {}, { otherId: peer.id }));
  assert.deepEqual(history.messages.map(row => row.id), [incoming, sent.id]);
});

test("inbox identity remains account-bound and requires the original current session", async () => {
  const first = member(), second = member(), peer = member(), otherPeer = member();
  message(peer, first, 10);
  message(otherPeer, second, 20);
  db.prepare("UPDATE users SET profile_audience='only_me' WHERE id=?").run(peer.id);
  for (const summary of [true, false]) {
    const ctx = await context(first);
    ctx.params = { id: second.id };
    ctx.body = { userId: second.id };
    ctx.query = { userId: second.id, summary: summary ? "1" : "0" };
    const result = routes["GET /api/me/threads"](ctx);
    assert.deepEqual(result.threads.map(row => row.otherId), [peer.id]);
    assert.deepEqual(result.threads[0].otherUser, unavailable(peer.id));
    const sibling = createSession(first.id);
    destroySession(ctx.token);
    assert.throws(() => routes["GET /api/me/threads"](ctx), { code: "AUTH_REQUIRED" });
    const siblingContext = await readAuthorizedRequest({ token: sibling.token, expectedAccount: first.id,
      method: "GET", pathname: "/api/me/threads", readBody: () => ({}) });
    assert.deepEqual(routes["GET /api/me/threads"]({ ...siblingContext, query: ctx.query }).threads.map(row => row.otherId), [peer.id]);
    assert.deepEqual((await inbox(second, summary)).threads.map(row => row.otherId), [otherPeer.id]);
    const guest = await context(null);
    guest.query = ctx.query;
    assert.throws(() => routes["GET /api/me/threads"](guest), { code: "AUTH_REQUIRED" });
    const switched = createSession(second.id);
    await assert.rejects(readAuthorizedRequest({ token: switched.token, expectedAccount: first.id,
      method: "GET", pathname: "/api/me/threads", readBody: () => ({}) }), { code: "IDENTITY_CHANGED" });
    const expired = await context(second);
    db.prepare("UPDATE sessions SET expires_at=0 WHERE user_id=?").run(second.id);
    assert.throws(() => routes["GET /api/me/threads"](expired), { code: "AUTH_REQUIRED" });
  }
});

test("neither block direction exposes a placeholder conversation or enables history access", async () => {
  for (const reverse of [false, true]) {
    const viewer = member(), peer = member();
    message(viewer, peer, 10);
    message(peer, viewer, 20);
    db.prepare("INSERT INTO blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)")
      .run(reverse ? peer.id : viewer.id, reverse ? viewer.id : peer.id, Date.now());
    for (const summary of [true, false]) assert.deepEqual((await inbox(viewer, summary)).threads, []);
    const ctx = await context(viewer, "GET", `/api/dms/${peer.id}`, {}, { otherId: peer.id });
    assert.throws(() => routes["GET /api/dms/:otherId"](ctx), error => error.status === 403);
  }
});
