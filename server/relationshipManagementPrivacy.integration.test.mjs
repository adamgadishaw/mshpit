import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const directory = mkdtempSync(join(tmpdir(), "pit-relationship-management-"));
process.env.NODE_ENV = "test";
process.env.PIT_DATA_DIR = directory;
process.env.PIT_ALLOW_EMPTY_DB_BOOTSTRAP = "true";
delete process.env.RESEND_API_KEY;
delete process.env.MAIL_FROM;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("Relationship privacy tests do not use network access"); };
const { db, q } = await import("./db.js");
const { routes } = await import("./api.js");
const { createSession, destroySession } = await import("./auth.js");
const { readAuthorizedRequest } = await import("./requestAuthorization.js");
after(() => { globalThis.fetch = originalFetch; db.close(); rmSync(directory, { recursive: true, force: true }); });

let sequence = 0;
function member() {
  const id = `relationship_privacy_${++sequence}`;
  q.insertUser.run(id, `${id}@example.test`, `Synthetic name ${id}`, id, "unusable-fixture-password-record", "fan",
    null, "Synthetic home city", null, "RP", "#123456", Date.now());
  db.prepare("UPDATE users SET email_verified_at=?,bio='Synthetic biography' WHERE id=?").run(Date.now(), id);
  return q.userById.get(id);
}
async function context(user, method, path, body = {}, params = {}) {
  const token = user ? createSession(user.id).token : null;
  const authorized = await readAuthorizedRequest({ token, expectedAccount: user?.id, method, pathname: path, readBody: () => body });
  const headers = {};
  return { ...authorized, token, params, query: {}, ip: `relationship-test-${++sequence}`, headers,
    setHeader: (key, value) => { headers[key] = value; } };
}
async function relationship(user, target, kind, desired) {
  return routes[`POST /api/users/:id/${kind}`](await context(user, "POST", `/api/users/${target.id}/${kind}`,
    { [kind === "mute" ? "muted" : "blocked"]: desired }, { id: target.id }));
}
async function directoryFor(user, kind) {
  const ctx = await context(user, "GET", `/api/me/${kind}`);
  const result = routes[`GET /api/me/${kind}`](ctx);
  assert.equal(ctx.headers["Cache-Control"], "private, no-store");
  return result.users;
}
function expectUnavailable(row, id) {
  assert.deepEqual(row, { id, name: "Unavailable account", handle: "unavailable", initials: "?",
    avatarUri: null, avatarColor: null, profileUpdatedAt: 0, unavailable: true });
}

test("private and inactive profiles stay unavailable through both management lists", async () => {
  const viewer = member(), newcomer = member(), target = member();
  await relationship(viewer, target, "mute", true);
  const visible = (await directoryFor(viewer, "muted"))[0];
  assert.equal(visible.name, target.name);
  assert.equal(Object.hasOwn(visible, "bio"), false);
  assert.equal(Object.hasOwn(visible, "home"), false);
  for (const [field, value] of [["profile_audience", "only_me"], ["is_banned", 1],
    ["dormant_at", Date.now()], ["suspended_until", Date.now() + 60_000]]) {
    db.prepare(`UPDATE users SET ${field}=?,name='Changed inaccessible name',bio='Changed inaccessible biography' WHERE id=?`).run(value, target.id);
    const direct = await context(viewer, "GET", `/api/users/${target.id}`, {}, { id: target.id });
    assert.throws(() => routes["GET /api/users/:id"](direct), error => error.status === 404);
    await relationship(newcomer, target, "mute", true);
    expectUnavailable((await directoryFor(viewer, "muted"))[0], target.id);
    expectUnavailable((await directoryFor(newcomer, "muted"))[0], target.id);
    await relationship(viewer, target, "block", true);
    expectUnavailable((await directoryFor(viewer, "blocked"))[0], target.id);
    await relationship(viewer, target, "block", false);
    assert.deepEqual(await directoryFor(viewer, "blocked"), []);
    db.prepare(`UPDATE users SET ${field}=? WHERE id=?`).run(field === "profile_audience" ? "everyone" : field === "is_banned" ? 0 : null, target.id);
  }
  await relationship(viewer, target, "mute", false);
  assert.deepEqual(await directoryFor(viewer, "muted"), []);
  assert.equal((await directoryFor(newcomer, "muted"))[0].id, target.id, "another member's mute is unaffected");
});

test("bilateral blocks hide updated identity after follows and never prevent relationship removal", async () => {
  for (const targetInitiates of [false, true]) {
    const viewer = member(), target = member();
    db.prepare("INSERT INTO follows(follower_id,followee_id) VALUES(?,?),(?,?)").run(viewer.id, target.id, target.id, viewer.id);
    if (!targetInitiates) await relationship(viewer, target, "mute", true);
    await relationship(targetInitiates ? target : viewer, targetInitiates ? viewer : target, "block", true);
    db.prepare("UPDATE users SET name='Updated after block',bio='Updated private text' WHERE id=?").run(target.id);
    if (targetInitiates) await relationship(viewer, target, "mute", true);
    expectUnavailable((await directoryFor(viewer, "muted"))[0], target.id);
    const direct = await context(viewer, "GET", `/api/users/${target.id}`, {}, { id: target.id });
    assert.throws(() => routes["GET /api/users/:id"](direct), error => error.status === 404);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM follows WHERE follower_id=? OR followee_id=?").get(viewer.id, viewer.id).n, 0);
    await relationship(viewer, target, "mute", false);
    assert.deepEqual(await directoryFor(viewer, "muted"), []);
    if (!targetInitiates) {
      expectUnavailable((await directoryFor(viewer, "blocked"))[0], target.id);
      await relationship(viewer, target, "block", false);
      assert.deepEqual(await directoryFor(viewer, "blocked"), []);
    }
  }
});

test("management directories require the current session and only return that account's relationships", async () => {
  const viewer = member(), otherViewer = member(), target = member(), otherTarget = member();
  for (const kind of ["mute", "block"]) {
    await relationship(viewer, target, kind, true);
    await relationship(otherViewer, otherTarget, kind, true);
    const list = kind === "mute" ? "muted" : "blocked";
    const ctx = await context(viewer, "GET", `/api/me/${list}`);
    ctx.params = { id: otherViewer.id };
    ctx.query = { userId: otherViewer.id };
    ctx.body = { userId: otherViewer.id };
    assert.deepEqual(routes[`GET /api/me/${list}`](ctx).users.map(row => row.id), [target.id]);
    destroySession(ctx.token);
    assert.throws(() => routes[`GET /api/me/${list}`](ctx), { code: "AUTH_REQUIRED" });
    const guest = await context(null, "GET", `/api/me/${list}`);
    assert.throws(() => routes[`GET /api/me/${list}`](guest), { code: "AUTH_REQUIRED" });
  }
});
