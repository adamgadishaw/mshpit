import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LEGAL_ACCEPTANCE_VERSION } from "../src/domain/privacyDisclosures.mjs";
const directory = mkdtempSync(join(tmpdir(), "pit-signup-mailbox-http-"));
process.env.PIT_DATA_DIR = directory;
process.env.PIT_ALLOW_EMPTY_DB_BOOTSTRAP = "true";
process.env.PIT_ENV = "production";
process.env.RESEND_API_KEY = "synthetic-never-sent";
process.env.MAIL_FROM = "Fixture <noreply@example.test>";
const { db, q } = await import("./db.js");
const { routes } = await import("./api.js");
const { createSession, destroySession, hashPassword, parseCookies, resetRateLimitsForTests, sessionCookieHeaders } = await import("./auth.js");
const { readAuthorizedRequest } = await import("./requestAuthorization.js");
const { readJsonBody, assertUnsafeRequestOrigin } = await import("./requestSecurity.js");
const realFetch = globalThis.fetch;
const mailbox = new Map();
globalThis.fetch = async (input, options) => {
  if (String(input) === "https://api.resend.com/emails") {
    const message = JSON.parse(options.body);
    assert.equal(db.isTransaction, false, "mail follows commit");
    const token = `${message.text || ""} ${message.html || ""}`.match(/#verify=([A-Za-z0-9_-]{43})/)?.[1];
    if (token) {
      assert.match(message.text, /Confirm only if you started this signup/);
      assert.match(message.text, /password entered during signup/);
      assert.doesNotMatch(message.text, /use Pit straight away either way/);
      const email = Array.isArray(message.to) ? message.to[0] : message.to;
      mailbox.set(email, [...(mailbox.get(email) || []), token]);
    }
    return new Response(JSON.stringify({ id: "synthetic-delivery" }), { status: 200 });
  }
  assert.equal(new URL(input).hostname, "127.0.0.1");
  return realFetch(input, options);
};
let origin;
const server = createServer(async (req, res) => {
  const headers = { "Content-Type": "application/json" };
  try {
    const url = new URL(req.url, origin);
    assertUnsafeRequestOrigin(req.method, req.headers, new Set([origin]));
    const token = parseCookies(req.headers.cookie).pit_session;
    const authorized = await readAuthorizedRequest({ token, method: req.method, pathname: url.pathname,
      readBody: () => ["POST", "DELETE", "PATCH"].includes(req.method) ? readJsonBody(req) : {} });
    const handler = routes[`${req.method} ${url.pathname}`];
    const result = await handler({ ...authorized, token, params: {}, query: {}, ip: "signup-http-fixture", origin,
      setHeader: (key, value) => { headers[key] = value; },
      setSession: (session) => { headers["Set-Cookie"] = sessionCookieHeaders(session.token, session.expiresAt, false); },
      clearSession() {},
    });
    res.writeHead(200, headers); res.end(JSON.stringify(result));
  } catch (error) { res.writeHead(error.status || 500, headers); res.end(JSON.stringify({ code: error.code, message: error.message })); }
});
before(async () => { await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); origin = `http://127.0.0.1:${server.address().port}`; });
after(async () => { globalThis.fetch = realFetch; server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); rmSync(directory, { recursive: true, force: true }); });
beforeEach(() => resetRateLimitsForTests());
let sequence = 0;
async function request(path, body, cookie, method = "POST") {
  const response = await fetch(origin + path, { method, headers: { Origin: origin, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  await new Promise(resolve => setImmediate(resolve));
  return { status: response.status, body: await response.json(), cookies: response.headers.getSetCookie(), cache: response.headers.get("cache-control") };
}
function member(email = `member-http-${++sequence}@example.test`) {
  const id = `signup_http_${++sequence}`;
  q.insertUser.run(id, email, id, id, hashPassword("Existing-password1"), "fan", null, null, null, "SH", "#123456", Date.now());
  db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(Date.now(), id);
  return q.userById.get(id);
}
const signup = (email, extra = {}, cookie) => request("/api/signup", { name: "Mailbox Fixture", email, password: "New-password2", genres: ["Rock"], ageBand: "18_plus", termsVersion: LEGAL_ACCEPTANCE_VERSION, ...extra }, cookie);
const verify = token => request("/api/verify-email", { token });

test("signup mail uses its code-owned creation warning even when a stored template attempts to override it", async () => {
  db.prepare("INSERT INTO email_templates(key,subject,body,cta_label,cta_url,updated_at) VALUES (?,?,?,?,?,?)")
    .run("signup_verify", "Untrusted override", "Untrusted body", "Open", "https://untrusted.example.test", Date.now());
  try {
    const email = "code-owned-mail@example.test";
    assert.equal((await signup(email)).status, 200);
    assert.equal(mailbox.get(email)?.length, 1, "shared transport captured the reviewed creation warning and local verification link");
    assert.equal(q.userByEmail.get(email), undefined);
  } finally { db.prepare("DELETE FROM email_templates WHERE key='signup_verify'").run(); }
});

test("anonymous signup has uniform body and no cookie at zero, one and two existing accounts, even with matching passwords or createAdditional", async () => {
  for (const count of [0, 1, 2]) {
    const email = `occupancy-${count}@example.test`;
    for (let n = 0; n < count; n++) member(email);
    const before = q.usersByEmail.all(email);
    for (const extra of [{}, { password: "Existing-password1", createAdditional: true }]) {
      const result = await signup(email, extra);
      assert.equal(result.status, 200); assert.deepEqual(result.cookies, []); assert.equal(result.cache, "no-store");
      assert.match(result.body.cancelToken, /^[A-Za-z0-9_-]{43}$/);
      assert.deepEqual({ ...result.body, cancelToken: "opaque" }, { ok: true, pending: true, verificationRequired: true, cancelToken: "opaque" });
      assert.deepEqual(q.usersByEmail.all(email), before);
    }
    resetRateLimitsForTests();
  }
});

test("pending signup cannot authenticate, finish onboarding or publish; mailbox confirmation creates one verified account without a cookie", async () => {
  const email = "new-mailbox@example.test";
  const pending = await signup(email);
  assert.equal((await request("/api/login", { email, password: "New-password2" })).status, 401);
  assert.equal((await request("/api/me/onboarding/complete", { version: 1 })).status, 401);
  assert.equal((await request("/api/posts", { kind: "status", review: "No pending session" })).status, 401);
  const token = mailbox.get(email).at(-1);
  const results = await Promise.all([verify(token), verify(token)]);
  assert.ok(results.every(result => result.body.verified && result.cookies.length === 0));
  assert.equal(results.filter(result => result.body.alreadyVerified).length, 1);
  const user = q.userByEmail.get(email);
  assert.ok(user.email_verified_at); assert.equal(user.onboarding_version, 0);
  assert.equal(q.usersByEmail.all(email).length, 1);
  assert.equal((await request("/api/signup/cancel", { cancelToken: pending.body.cancelToken })).status, 200);
  assert.ok(q.userById.get(user.id), "old cancellation cannot delete a confirmed account");
  const login = await request("/api/login", { email, password: "New-password2" });
  assert.equal(login.status, 200); assert.equal(login.body.user.id, user.id);
  assert.equal((await request("/api/me/onboarding/complete", { version: 1 }, login.cookies[0].split(";")[0])).status, 200);
});

test("duplicate/resend links never replace another payload and cannot recreate accounts after an email is reused", async () => {
  const email = "duplicate-mailbox@example.test";
  await signup(email, { name: "First Submission" });
  await signup(email, { name: "Second Submission" });
  const [first, second] = mailbox.get(email);
  assert.equal((await verify(first)).body.verified, true);
  assert.equal(q.userByEmail.get(email).name, "First Submission");
  assert.equal((await verify(second)).body.outcome, "account_exists");
  const user = q.userByEmail.get(email);
  db.prepare("UPDATE users SET email=? WHERE id=?").run("moved-mailbox@example.test", user.id);
  assert.equal((await verify(first)).body.verified, false, "receipt binds original address");
  assert.equal((await verify(second)).body.outcome, "account_exists");
  assert.equal(q.usersByEmail.all(email).length, 0);
  await signup(email); const fresh = mailbox.get(email).at(-1);
  assert.equal((await verify(fresh)).body.verified, true);
});

test("cancelled, expired and later-occupied reservations fail closed with useful mailbox-proven occupation outcome", async () => {
  const cancelled = await signup("cancelled-mailbox@example.test");
  const token = mailbox.get("cancelled-mailbox@example.test").at(-1);
  await request("/api/signup/cancel", { cancelToken: cancelled.body.cancelToken });
  assert.equal((await verify(token)).body.verified, false);
  await signup("expired-mailbox@example.test");
  db.prepare("UPDATE signup_reservations SET created_at=1,expires_at=2 WHERE email=?").run("expired-mailbox@example.test");
  assert.equal((await verify(mailbox.get("expired-mailbox@example.test").at(-1))).body.verified, false);
  await signup("race-mailbox@example.test"); member("race-mailbox@example.test");
  assert.equal((await verify(mailbox.get("race-mailbox@example.test").at(-1))).body.outcome, "account_exists");
});

test("additional signup needs verified session/password proof and concurrent confirmations cannot exceed the final slot", async () => {
  const actor = member(); const session = createSession(actor.id); const cookie = `pit_session=${session.token}`;
  assert.equal((await signup(actor.email, { addAccount: true, currentPassword: "Existing-password1" })).status, 401);
  assert.equal((await signup(actor.email, { addAccount: true, currentPassword: "wrong-password1" }, cookie)).status, 401);
  for (let n = 0; n < 2; n++) {
    const result = await signup(actor.email, { addAccount: true, currentPassword: "Existing-password1" }, cookie);
    assert.equal(result.status, 200); assert.deepEqual(result.cookies, []);
  }
  assert.equal(q.usersByEmail.all(actor.email).length, 1);
  const results = await Promise.all(mailbox.get(actor.email).map(verify));
  assert.equal(results.filter(result => result.body.verified).length, 1);
  assert.equal(results.filter(result => result.body.outcome === "account_exists").length, 1);
  assert.equal(q.usersByEmail.all(actor.email).length, 2);
});

test("logout revokes an additional-account reservation without touching its existing account", async () => {
  const actor = member(); const session = createSession(actor.id);
  await signup(actor.email, { addAccount: true, currentPassword: "Existing-password1" }, `pit_session=${session.token}`);
  destroySession(session.token);
  assert.equal((await verify(mailbox.get(actor.email).at(-1))).body.verified, false);
  assert.equal(q.usersByEmail.all(actor.email).length, 1);
});

test("real HTTP password recovery revokes a staged sibling while preserving the existing account", async () => {
  const actor = member(); const session = createSession(actor.id);
  await signup(actor.email, { addAccount: true, currentPassword: "Existing-password1" }, `pit_session=${session.token}`);
  const reservationToken = mailbox.get(actor.email).at(-1);
  const resetToken = "R".repeat(43);
  db.prepare("UPDATE users SET reset_hash=?,reset_expires=? WHERE id=?")
    .run(createHash("sha256").update(resetToken).digest("hex"), Date.now() + 60_000, actor.id);
  assert.equal((await request("/api/reset", { token: resetToken, password: "Recovered-password3" })).status, 200);
  assert.equal((await verify(reservationToken)).body.verified, false);
  assert.equal(q.usersByEmail.all(actor.email).length, 1);
  assert.equal((await request("/api/login", { email: actor.email, password: "Recovered-password3" })).status, 200);
});

test("direct signup handler rechecks session and credential authority after password verification yields", async () => {
  for (const change of ["logout", "password", "email", "role"]) {
    resetRateLimitsForTests();
    const actor = member(); const session = createSession(actor.id);
    const body = { name: "Await Fixture", email: actor.email, password: "New-password2", genres: ["Rock"],
      ageBand: "18_plus", termsVersion: LEGAL_ACCEPTANCE_VERSION, addAccount: true, currentPassword: "Existing-password1" };
    const authorized = await readAuthorizedRequest({ token: session.token, method: "POST", pathname: "/api/signup", readBody: () => body });
    let checked = 0;
    await assert.rejects(() => routes["POST /api/signup"]({ ...authorized, token: session.token, ip: `await-${change}`,
      setHeader() {}, setSession() { assert.fail("signup must not issue a session"); },
      assertCurrentSession(options) {
        const current = authorized.assertCurrentSession(options);
        if (++checked === 1) queueMicrotask(() => {
          if (change === "logout") destroySession(session.token);
          if (change === "password") db.prepare("UPDATE users SET pass_hash='revoked-proof' WHERE id=?").run(actor.id);
          if (change === "email") db.prepare("UPDATE users SET email=? WHERE id=?").run(`changed-${actor.email}`, actor.id);
          if (change === "role") db.prepare("UPDATE users SET role='moderator' WHERE id=?").run(actor.id);
        });
        return current;
      },
    }), error => [401, 403, 409].includes(error.status), change);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM signup_reservations WHERE actor_id=?").get(actor.id).n, 0, change);
    assert.ok(q.userById.get(actor.id));
  }
});
