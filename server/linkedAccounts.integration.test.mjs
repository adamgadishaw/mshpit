import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before, beforeEach } from "node:test";
import { LEGAL_ACCEPTANCE_VERSION } from "../src/domain/privacyDisclosures.mjs";

const directory = mkdtempSync(join(tmpdir(), "pit-linked-accounts-integration-"));
process.env.PIT_DATA_DIR = directory;
process.env.PIT_ALLOW_EMPTY_DB_BOOTSTRAP = "true";
process.env.EMAIL_VERIFICATION_ENABLED = "true";
delete process.env.RESEND_API_KEY;
delete process.env.MAIL_FROM;
const { db, q } = await import("./db.js");
const { routes } = await import("./api.js");
const { createSession, getSession, hashPassword, parseCookies, resetRateLimitsForTests,
  sessionCookieHeaders, clearSessionCookies, COOKIE } = await import("./auth.js");
const { readAuthorizedRequest } = await import("./requestAuthorization.js");
const { readJsonBody, assertUnsafeRequestOrigin } = await import("./requestSecurity.js");
const { mintVerifyToken } = await import("./verification.js");

function matchRoute(method, pathname) {
  const direct = routes[`${method} ${pathname}`];
  if (direct) return { handler: direct, params: {} };
  const segments = pathname.split("/");
  for (const [key, handler] of Object.entries(routes)) {
    const [verb, pattern] = key.split(" "), expected = pattern.split("/");
    if (verb !== method || expected.length !== segments.length) continue;
    const params = {};
    if (expected.every((segment, index) => segment.startsWith(":")
      ? (params[segment.slice(1)] = segments[index], true) : segment === segments[index])) return { handler, params };
  }
  return null;
}

// Local HTTP transport exercises the real route table, credential/session DB,
// production cookie serialization/parsing, and pre-route identity/verification
// guards without starting index.js's external-provider background schedulers.
let nextBodyStarted = null;
const server = createServer(async (req, res) => {
  const headers = {};
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    assertUnsafeRequestOrigin(req.method, req.headers, new Set([origin]));
    const token = parseCookies(req.headers.cookie)[COOKIE];
    const authorized = await readAuthorizedRequest({ token, expectedAccount: req.headers["x-pit-expected-account"],
      method: req.method, pathname: url.pathname, readBody: () => {
        if (!["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) return {};
        const observe = nextBodyStarted; nextBodyStarted = null; observe?.();
        return readJsonBody(req);
      } });
    const match = matchRoute(req.method, url.pathname);
    if (!match) throw new Error("Test route missing");
    const result = await match.handler({ ...authorized, token, query: Object.fromEntries(url.searchParams), params: match.params,
      ip: "linked-cookie-test", ua: "test", origin: "http://127.0.0.1",
      setHeader: (key, value) => { headers[key] = value; },
      setSession: (replacement) => { headers["Set-Cookie"] = sessionCookieHeaders(replacement.token, replacement.expiresAt, false); },
      clearSession: () => { headers["Set-Cookie"] = clearSessionCookies(false); },
    });
    res.writeHead(200, { "Content-Type": "application/json", ...headers });
    res.end(JSON.stringify(result));
  } catch (error) {
    res.writeHead(error.status || 500, { "Content-Type": "application/json", ...headers });
    res.end(JSON.stringify({ code: error.code || "INTERNAL_ERROR", message: error.message }));
  }
});
let origin;
before(async () => {
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  db.close();
  rmSync(directory, { recursive: true, force: true });
});
beforeEach(() => resetRateLimitsForTests());
let sequence = 0;
function member({ email = `linked-${++sequence}@example.test`, password = "Same-password1", role = "fan", verified = true } = {}) {
  const id = `linked_${++sequence}`;
  q.insertUser.run(id, email, id, id, hashPassword(password), role, null, null, null, "LA", "#123456", Date.now());
  if (verified) db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(Date.now(), id);
  return q.userById.get(id);
}
async function request(path, { method = "GET", body, cookie, expectedAccount } = {}) {
  const response = await fetch(`${origin}${path}`, { method, headers: {
    ...(body ? { "Content-Type": "application/json" } : {}),
    ...(cookie ? { Cookie: cookie } : {}),
    ...(expectedAccount ? { "X-Pit-Expected-Account": expectedAccount } : {}),
  }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const serializedCookie = response.headers.getSetCookie().find((value) => value.startsWith(`${COOKIE}=`));
  return { status: response.status, body: await response.json(), headers: response.headers,
    serializedCookie, cookie: serializedCookie?.split(";", 1)[0] };
}
const login = (user, password = "Same-password1") => request("/api/login", {
  method: "POST", body: { email: user.email, password, accountId: user.id },
});
const ids = (response) => response.body.accounts.map((account) => account.id);

function startHeldPost(cookie, accountId) {
  let client;
  const ready = new Promise((resolve) => { nextBodyStarted = resolve; });
  const response = new Promise((resolve, reject) => {
    client = httpRequest(`${origin}/api/posts`, { method: "POST", headers: {
      "Content-Type": "application/json", Cookie: cookie, "X-Pit-Expected-Account": accountId,
    } }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }); }
        catch (error) { reject(error); }
      });
      res.on("error", reject);
    });
    client.on("error", reject);
    client.setTimeout(10_000, () => client.destroy(new Error("Local held request timed out")));
    client.write('{"kind":"status","review":');
  });
  return { ready, response, finish: () => client.end('"Held publication must not save"}'),
    close: () => client.destroy() };
}

test("real HTTP body waits cannot preserve a revoked session or borrow another account's authority", async () => {
  for (const mode of ["logout", "expiry", "password-change", "password-reset"]) {
    const actor = member(), independent = member();
    const initial = await login(actor);
    const unrelated = await login(independent);
    assert.equal(initial.status, 200);
    assert.equal(unrelated.status, 200);
    const pending = startHeldPost(initial.cookie, actor.id);
    try {
      await pending.ready;
      if (mode === "logout") {
        const result = await request("/api/logout", { method: "POST", cookie: initial.cookie, body: {} });
        assert.equal(result.status, 200);
        assert.match(result.serializedCookie, /Max-Age=0/);
      } else if (mode === "expiry") {
        db.prepare("UPDATE sessions SET expires_at=? WHERE user_id=?").run(Date.now() - 1, actor.id);
      } else if (mode === "password-change") {
        const result = await request("/api/me/password", { method: "POST", cookie: initial.cookie,
          body: { currentPassword: "Same-password1", password: "Changed-password2" } });
        assert.equal(result.status, 200);
        assert.equal((await request("/api/me", { cookie: result.cookie })).body.user.id, actor.id);
      } else {
        const token = randomBytes(32).toString("base64url");
        db.prepare("UPDATE users SET reset_hash=?,reset_expires=? WHERE id=?")
          .run(createHash("sha256").update(token).digest("hex"), Date.now() + 60_000, actor.id);
        const result = await request("/api/reset", { method: "POST", body: { token, password: "Reset-password3" } });
        assert.equal(result.status, 200);
        const replay = await request("/api/reset", { method: "POST", body: { token, password: "Replay-password4" } });
        assert.equal(replay.status, 400);
        assert.equal(replay.cookie, undefined);
      }
      assert.equal((await request("/api/me", { cookie: unrelated.cookie, expectedAccount: independent.id })).body.user.id, independent.id,
        "independent requests must still complete while the first request body is held");
      pending.finish();
      const blocked = await pending.response;
      assert.equal(blocked.status, 409, mode);
      assert.equal(blocked.body.code, "IDENTITY_CHANGED", mode);
      assert.equal(db.prepare("SELECT COUNT(*) n FROM posts WHERE user_id=?").get(actor.id).n, 0, mode);
      assert.equal((await request("/api/me", { cookie: initial.cookie })).body.user, null, mode);
    } finally { pending.close(); }
  }
});

test("actual concurrent reset requests consume a reset capability only once", async () => {
  const user = member();
  const token = randomBytes(32).toString("base64url");
  db.prepare("UPDATE users SET reset_hash=?,reset_expires=? WHERE id=?")
    .run(createHash("sha256").update(token).digest("hex"), Date.now() + 60_000, user.id);
  const results = await Promise.all(["First-password1", "Second-password2"].map((password) =>
    request("/api/reset", { method: "POST", body: { token, password } })));
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 400]);
  assert.equal(results.filter((result) => result.cookie).length, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sessions WHERE user_id=?").get(user.id).n, 1);
  assert.equal(db.isTransaction, false);
});

test("password login proves both accounts and a cookie-only switch rotates identity with a fixed staff cap", async () => {
  const fan = member();
  const admin = member({ email: fan.email, role: "admin" });
  const initial = await login(fan);
  assert.equal(initial.status, 200);
  assert.match(initial.serializedCookie, /HttpOnly/);
  assert.match(initial.serializedCookie, /SameSite=Lax/);
  const originalSession = getSession(parseCookies(initial.cookie)[COOKIE]);
  assert.deepEqual(ids(await request("/api/me/accounts", { cookie: initial.cookie, expectedAccount: fan.id })), [fan.id, admin.id]);
  const switched = await request("/api/me/accounts/switch", { method: "POST", cookie: initial.cookie,
    expectedAccount: fan.id, body: { accountId: admin.id } });
  assert.equal(switched.status, 200);
  assert.equal(switched.body.user.id, admin.id);
  assert.notEqual(switched.cookie, initial.cookie);
  assert.equal(switched.headers.get("cache-control"), "no-store");
  assert.equal(getSession(parseCookies(initial.cookie)[COOKIE]), null);
  const adminSession = getSession(parseCookies(switched.cookie)[COOKIE]);
  assert.equal(adminSession.user_id, admin.id);
  assert.equal(adminSession.created_at, originalSession.created_at);
  assert.equal(adminSession.expires_at, originalSession.created_at + 12 * 60 * 60 * 1000);
  assert.equal((await request("/api/me", { cookie: switched.cookie, expectedAccount: admin.id })).body.user.id, admin.id);
  const stale = await request("/api/me/accounts/switch", { method: "POST", cookie: switched.cookie,
    expectedAccount: fan.id, body: { accountId: fan.id } });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, "IDENTITY_CHANGED");
  assert.equal(stale.cookie, undefined);
  assert.equal((await request("/api/me/accounts", { cookie: initial.cookie })).status, 401);
});

test("same email with different passwords never reveals or grants the sibling; forged IDs remain forbidden", async () => {
  const fan = member();
  const sibling = member({ email: fan.email, password: "Different-password2", role: "admin" });
  const unrelated = member();
  const logged = await login(fan);
  assert.equal(logged.status, 200);
  assert.deepEqual(ids(await request("/api/me/accounts", { cookie: logged.cookie })), [fan.id]);
  for (const accountId of [sibling.id, unrelated.id]) {
    const result = await request("/api/me/accounts/switch", { method: "POST", cookie: logged.cookie,
      body: { accountId } });
    assert.equal(result.status, 403);
    assert.equal(result.cookie, undefined);
  }
  const forgedLogin = await request("/api/login", { method: "POST", body: {
    email: fan.email, password: "Same-password1", accountId: sibling.id,
  } });
  assert.equal(forgedLogin.status, 401);
  assert.equal(forgedLogin.cookie, undefined);
});

test("another browser requires its own password proof despite a persisted pair", async () => {
  const first = member();
  const second = member({ email: first.email });
  await login(first);
  const legacySession = createSession(first.id);
  const cookie = `${COOKIE}=${legacySession.token}`;
  assert.deepEqual(ids(await request("/api/me/accounts", { cookie })), [first.id]);
  assert.equal((await request("/api/me/accounts/switch", { method: "POST", cookie, body: { accountId: second.id } })).status, 403);
  const connected = await request("/api/me/accounts/connect", { method: "POST", cookie, body: { password: "Same-password1" } });
  assert.equal(connected.status, 200);
  assert.equal(connected.body.connected, true);
  assert.deepEqual(ids(connected), [first.id, second.id]);
  assert.equal((await request("/api/me/accounts/switch", { method: "POST", cookie, body: { accountId: second.id } })).status, 200);
});

test("signup same-password proof stays restricted until both email confirmations", async () => {
  const original = member();
  const signup = await request("/api/signup", { method: "POST", body: {
    name: "New Linked Member", email: original.email, password: "Same-password1", createAdditional: true,
    genres: ["Rock"], ageBand: "18_plus", termsVersion: LEGAL_ACCEPTANCE_VERSION,
  } });
  assert.equal(signup.status, 200);
  assert.equal(signup.body.created, true);
  const createdId = signup.body.user.id;
  assert.notEqual(createdId, original.id);
  assert.deepEqual(ids(await request("/api/me/accounts", { cookie: signup.cookie })), [createdId]);
  assert.equal((await request("/api/me/accounts/switch", { method: "POST", cookie: signup.cookie,
    body: { accountId: original.id } })).status, 403);
  assert.equal((await request("/api/posts", { method: "POST", cookie: signup.cookie, body: { text: "Must not publish" } })).status, 403);
  const verified = await request("/api/verify-email", { method: "POST", cookie: signup.cookie,
    body: { token: mintVerifyToken(createdId) } });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.verified, true);
  assert.deepEqual(ids(await request("/api/me/accounts", { cookie: signup.cookie })), [createdId, original.id]);
  const result = await request("/api/me/accounts/switch", { method: "POST", cookie: signup.cookie,
    expectedAccount: createdId, body: { accountId: original.id } });
  assert.equal(result.status, 200);
  assert.equal(result.body.user.id, original.id);
});

test("HTTP signup cookie blocks public and social writes until verification while retaining privacy and cancellation", async () => {
  const original = member({ role: "admin" }), recipient = member();
  db.prepare("UPDATE users SET age_band='18_plus',dm_policy='people_i_follow' WHERE id=?").run(recipient.id);
  const originalLogin = await login(original);
  const originalHash = q.userById.get(original.id).pass_hash;
  const signup = await request("/api/signup", { method: "POST", cookie: originalLogin.cookie, body: {
    name: "Restricted HTTP Member", email: original.email, password: "Separate-password2",
    genres: ["Rock"], ageBand: "18_plus", termsVersion: LEGAL_ACCEPTANCE_VERSION,
    role: "admin", id: original.id, emailVerified: true,
  } });
  assert.equal(signup.status, 200);
  assert.equal(signup.body.created, true);
  assert.equal(signup.body.verificationRequired, true);
  assert.equal(signup.body.user.emailVerified, false);
  assert.equal(signup.body.user.role, "fan");
  assert.match(signup.serializedCookie, /HttpOnly/);
  const accountId = signup.body.user.id;
  const originalBio = q.userById.get(accountId).bio;
  assert.notEqual(accountId, original.id);
  db.prepare("INSERT INTO follows (follower_id,followee_id) VALUES (?,?)").run(recipient.id, accountId);
  assert.equal((await request("/api/me", { cookie: signup.cookie })).body.user.id, accountId);
  const mutations = [
    ["POST", "/api/posts", { kind: "status", review: "A great local concert" }],
    ["POST", `/api/dms/${recipient.id}`, { text: "Looking forward to the show" }],
    ["PATCH", "/api/me", { bio: "Live music fan" }],
    ["PATCH", "/api/me", { theme: "stage", bio: "Hidden public edit" }],
    ["DELETE", "/api/posts/nonexistent", {}],
  ];
  for (const [method, path, body] of mutations) {
    const denied = await request(path, { method, body, cookie: signup.cookie, expectedAccount: accountId });
    assert.equal(denied.status, 403, path);
    assert.equal(denied.body.code, "EMAIL_VERIFICATION_REQUIRED", path);
  }
  assert.equal(db.prepare("SELECT COUNT(*) n FROM posts WHERE user_id=?").get(accountId).n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM dms WHERE from_id=?").get(accountId).n, 0);
  assert.equal(q.userById.get(accountId).bio, originalBio);
  const privacy = await request("/api/me", { method: "PATCH", cookie: signup.cookie,
    body: { theme: "stage", profileAudience: "only_me", directMessagePolicy: "mutuals" } });
  assert.equal(privacy.status, 200);
  assert.equal(privacy.body.user.profileAudience, "only_me");
  const verified = await request("/api/verify-email", { method: "POST", cookie: signup.cookie,
    body: { token: mintVerifyToken(accountId) } });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.verified, true);
  assert.equal(verified.body.user.id, accountId);
  for (const [method, path, body] of mutations.slice(0, 3)) {
    const saved = await request(path, { method, body, cookie: signup.cookie, expectedAccount: accountId });
    assert.equal(saved.status, 200, `${path}: ${JSON.stringify(saved.body)}`);
  }
  assert.equal(db.prepare("SELECT COUNT(*) n FROM posts WHERE user_id=?").get(accountId).n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM dms WHERE from_id=?").get(accountId).n, 1);
  assert.equal(q.userById.get(accountId).bio, "Live music fan");
  assert.equal(q.userById.get(original.id).pass_hash, originalHash);
  assert.equal((await request("/api/me", { cookie: originalLogin.cookie })).body.user.id, original.id);

  const unfinished = await request("/api/signup", { method: "POST", body: {
    name: "Cancel HTTP Member", email: `cancel-http-${++sequence}@example.test`, password: "Cancel-password3",
    genres: ["Rock"], ageBand: "18_plus", termsVersion: LEGAL_ACCEPTANCE_VERSION,
  } });
  assert.equal(unfinished.status, 200);
  const cancelled = await request("/api/signup/cancel", { method: "POST", cookie: unfinished.cookie,
    body: { cancelToken: unfinished.body.cancelToken } });
  assert.equal(cancelled.status, 200);
  assert.equal(q.userById.get(unfinished.body.user.id), undefined);
  assert.equal(getSession(parseCookies(unfinished.cookie)[COOKIE]), null);
  assert.ok(q.userById.get(accountId));
  assert.ok(q.userById.get(original.id));
});

test("reset and password-change verify outside and grant only matching siblings inside credential transactions", async () => {
  const first = member({ password: "Old-password1" });
  const second = member({ email: first.email, password: "Replacement-password2" });
  const resetToken = randomBytes(32).toString("base64url");
  db.prepare("UPDATE users SET reset_hash=?,reset_expires=? WHERE id=?")
    .run(createHash("sha256").update(resetToken).digest("hex"), Date.now() + 60_000, first.id);
  const reset = await request("/api/reset", { method: "POST", body: { token: resetToken, password: "Replacement-password2" } });
  assert.equal(reset.status, 200);
  assert.deepEqual(ids(await request("/api/me/accounts", { cookie: reset.cookie })), [first.id, second.id]);
  const oldCookie = reset.cookie;
  const changed = await request("/api/me/password", { method: "POST", cookie: oldCookie, expectedAccount: first.id,
    body: { currentPassword: "Replacement-password2", password: "Separate-password3" } });
  assert.equal(changed.status, 200);
  assert.deepEqual(ids(await request("/api/me/accounts", { cookie: changed.cookie })), [first.id]);
  assert.equal(getSession(parseCookies(oldCookie)[COOKIE]), null);
  const restored = await request("/api/me/password", { method: "POST", cookie: changed.cookie, expectedAccount: first.id,
    body: { currentPassword: "Separate-password3", password: "Replacement-password2" } });
  assert.equal(restored.status, 200);
  assert.deepEqual(ids(await request("/api/me/accounts", { cookie: restored.cookie })), [first.id, second.id]);
});
