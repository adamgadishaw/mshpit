import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const directory = mkdtempSync(join(tmpdir(), "pit-staff-lifetime-"));
process.env.PIT_DATA_DIR = directory;
process.env.PIT_ALLOW_EMPTY_DB_BOOTSTRAP = "true";
process.env.NEWSROOM_BROWSER_SESSIONS_ENABLED = "true";
delete process.env.RESEND_API_KEY;
delete process.env.MAIL_FROM;
const { db, q } = await import("./db.js");
const { createSession, getSession, createNewsroomSession, sessionTtlForRole,
  hashPassword, PRIVILEGED_SESSION_TTL_MS, STANDARD_SESSION_TTL_MS,
  NEWSROOM_SESSION_IDLE_MS } = await import("./auth.js");
const { routes } = await import("./api.js");
const realNow = Date.now;
after(() => { Date.now = realNow; db.close(); rmSync(directory, { recursive: true, force: true }); });

let sequence = 0;
const password = "Synthetic-staff-password1";
const passHash = hashPassword(password);
function account(role, email) {
  const id = `staff_lifetime_${++sequence}`;
  q.insertUser.run(id, email || `${id}@example.test`, id, id, passHash, role,
    null, null, null, "SL", "#123456", realNow());
  db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(realNow(), id);
  return q.userById.get(id);
}

test("every staff role receives a twelve-hour full session, while ordinary accounts keep thirty days", () => {
  for (const role of ["admin", "moderator", "editor", "fan", "artist"]) {
    const at = realNow();
    const actor = account(role);
    try {
      Date.now = () => at;
      const expected = ["admin", "moderator", "editor"].includes(role)
        ? PRIVILEGED_SESSION_TTL_MS : STANDARD_SESSION_TTL_MS;
      assert.equal(sessionTtlForRole(role), expected, role);
      const session = createSession(actor.id);
      assert.equal(session.expiresAt, at + expected, role);
      Date.now = () => session.expiresAt - 1;
      assert.equal(getSession(session.token)?.user_id, actor.id, role);
      Date.now = () => session.expiresAt;
      assert.equal(getSession(session.token), null, role);
    } finally { Date.now = realNow; }
  }
});

test("an existing long editor row is capped without waiting for a new login or migration", () => {
  const actor = account("editor"), at = realNow();
  const session = createSession(actor.id);
  db.prepare("UPDATE sessions SET created_at=?,expires_at=? WHERE user_id=?")
    .run(at, at + STANDARD_SESSION_TTL_MS, actor.id);
  try {
    Date.now = () => at + PRIVILEGED_SESSION_TTL_MS;
    assert.equal(getSession(session.token), null);
    Date.now = () => at;
    assert.equal(getSession(session.token), null, "expired authority cannot revive after a clock rollback");
  } finally { Date.now = realNow; }
});

test("promotion to editor cannot turn a long member session into long staff access", () => {
  const actor = account("fan"), at = realNow();
  const session = createSession(actor.id);
  db.prepare("UPDATE sessions SET created_at=?,expires_at=? WHERE user_id=?")
    .run(at - PRIVILEGED_SESSION_TTL_MS, at + STANDARD_SESSION_TTL_MS, actor.id);
  db.prepare("UPDATE users SET role='editor' WHERE id=?").run(actor.id);
  try {
    Date.now = () => at;
    assert.equal(getSession(session.token), null);
  } finally { Date.now = realNow; }
});

test("editor account switching retains the original staff deadline through a member round trip", async () => {
  const fan = account("fan"), editor = account("editor", fan.email), at = realNow();
  let active;
  try {
    Date.now = () => at;
    await routes["POST /api/login"]({ body: { email: fan.email, password, accountId: fan.id },
      ip: `staff-lifetime-${fan.id}`, setSession(value) { active = value; } });
    const firstToken = active.token;
    Date.now = () => at + 60_000;
    for (const [actor, target] of [[fan, editor], [editor, fan]]) {
      routes["POST /api/me/accounts/switch"]({ user: actor, token: active.token,
        body: { accountId: target.id }, ip: `staff-lifetime-${actor.id}`, setHeader() {},
        setSession(value) { active = value; } });
      assert.equal(active.expiresAt, at + PRIVILEGED_SESSION_TTL_MS);
      assert.equal(getSession(active.token)?.created_at, at);
    }
    assert.equal(getSession(firstToken), null);
    Date.now = () => at + PRIVILEGED_SESSION_TTL_MS;
    assert.equal(getSession(active.token), null);
  } finally { Date.now = realNow; }
});

test("separately approved scoped Newsroom access keeps its own lifetime for editors", () => {
  const actor = account("editor"), at = realNow();
  try {
    Date.now = () => at;
    const full = createSession(actor.id), scoped = createNewsroomSession(actor.id);
    assert.equal(scoped.expiresAt, at + NEWSROOM_SESSION_IDLE_MS);
    Date.now = () => at + PRIVILEGED_SESSION_TTL_MS;
    assert.equal(getSession(full.token), null);
    assert.equal(getSession(scoped.token), null, "remembered Newsroom never grants full account authority");
    assert.equal(getSession(scoped.token, { scope: "newsroom" })?.user_id, actor.id);
  } finally { Date.now = realNow; }
});
