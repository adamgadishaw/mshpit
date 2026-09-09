import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const directory = mkdtempSync(join(tmpdir(), "pit-request-authorization-"));
process.env.PIT_DATA_DIR = directory;
process.env.PIT_ALLOW_EMPTY_DB_BOOTSTRAP = "true";
delete process.env.RESEND_API_KEY;
delete process.env.MAIL_FROM;
const { db, q, artistStmts } = await import("./db.js");
const { createSession, destroySession, getSession, hashPassword } = await import("./auth.js");
const { readAuthorizedRequest } = await import("./requestAuthorization.js");
const { routes } = await import("./api.js");
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
let sequence = 0;
function member() {
  const id = `request_authorization_${++sequence}`;
  q.insertUser.run(id, `${id}@example.test`, id, id, hashPassword("Original-password1"),
    "fan", null, null, null, "RA", "#123456", Date.now());
  db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(Date.now(), id);
  return q.userById.get(id);
}
const body = { kind: "status", review: "Authorized text" };
const request = (session, options = {}) => readAuthorizedRequest({
  token: session.token, method: "POST", pathname: "/api/posts", readBody: () => body, ...options,
});

test("ratings, follows, and messages reject stale authority between body authorization and route dispatch", async () => {
  for (const mode of ["logout", "expiry", "unverified", "banned"]) {
    for (const action of ["rating", "follow", "message"]) {
      const user = member();
      const other = member();
      db.prepare("UPDATE users SET age_band='18_plus',dm_policy='people_i_follow' WHERE id IN (?,?)").run(user.id, other.id);
      db.prepare("INSERT INTO follows (follower_id,followee_id) VALUES (?,?)").run(other.id, user.id);
      const [route, pathname, payload, params] = action === "rating"
        ? ["POST /api/ratings", "/api/ratings", { kind: "album", ref: "Guarded Album", rating: 4 }, {}]
        : action === "follow"
          ? ["POST /api/users/:id/follow", `/api/users/${other.id}/follow`, { following: true }, { id: other.id }]
          : ["POST /api/dms/:otherId", `/api/dms/${other.id}`, { text: "Authorized fixture message" }, { otherId: other.id }];
      const session = createSession(user.id);
      const authorized = await request(session, { pathname, readBody: () => payload });
      if (mode === "logout") destroySession(session.token);
      if (mode === "expiry") db.prepare("UPDATE sessions SET expires_at=0 WHERE user_id=?").run(user.id);
      if (mode === "unverified") db.prepare("UPDATE users SET email_verified_at=0 WHERE id=?").run(user.id);
      if (mode === "banned") db.prepare("UPDATE users SET is_banned=1 WHERE id=?").run(user.id);
      assert.throws(() => routes[route]({ ...authorized, params, ip: user.id }),
        (error) => ["AUTH_REQUIRED", "EMAIL_VERIFICATION_REQUIRED", "FORBIDDEN"].includes(error.code), `${mode}/${action}`);
      assert.equal(db.prepare("SELECT COUNT(*) n FROM ratings WHERE user_id=?").get(user.id).n, 0);
      assert.equal(db.prepare("SELECT COUNT(*) n FROM follows WHERE follower_id=?").get(user.id).n, 0);
      assert.equal(db.prepare("SELECT COUNT(*) n FROM dms WHERE from_id=?").get(user.id).n, 0);
    }
  }
});

test("logout or expiry while reading JSON cannot publish using the earlier session", async () => {
  for (const mode of ["logout", "expiry", "password-reset"]) {
    const user = member();
    const session = createSession(user.id);
    let releaseBody;
    const pending = request(session, { readBody: () => new Promise((resolve) => { releaseBody = resolve; }) });
    if (mode === "logout") destroySession(session.token);
    else if (mode === "expiry") db.prepare("UPDATE sessions SET expires_at=? WHERE user_id=?").run(Date.now() - 1, user.id);
    else db.prepare("DELETE FROM sessions WHERE user_id=?").run(user.id);
    releaseBody(body);
    const authorized = await pending;
    assert.equal(authorized.user, null);
    assert.throws(() => routes["POST /api/posts"]({ ...authorized, ip: mode }),
      (error) => error.status === 401 && error.code === "AUTH_REQUIRED");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM posts WHERE user_id=?").get(user.id).n, 0);
  }
});

test("body completion rechecks verification and the expected account before any mutation", async () => {
  const user = member();
  const session = createSession(user.id);
  await assert.rejects(request(session, { readBody() {
    db.prepare("UPDATE users SET email_verified_at=0 WHERE id=?").run(user.id);
    return body;
  } }), (error) => error.code === "EMAIL_VERIFICATION_REQUIRED");
  destroySession(session.token);
  await assert.rejects(request(session, { expectedAccount: user.id }),
    (error) => error.code === "IDENTITY_CHANGED");
});

test("long-running work rechecks current restrictions and the original session, not a sibling session", async () => {
  for (const mode of ["logout", "expiry", "unverified", "dormant", "banned", "suspended"]) {
    const user = member();
    const session = createSession(user.id);
    const authorized = await request(session);
    assert.equal(authorized.assertCurrentSession().id, user.id);
    const sibling = createSession(user.id);
    if (mode === "logout") destroySession(session.token);
    if (mode === "expiry") db.prepare("UPDATE sessions SET expires_at=? WHERE token_hash=?")
      .run(Date.now() - 1, getSession(session.token).token_hash);
    if (mode === "unverified") db.prepare("UPDATE users SET email_verified_at=0 WHERE id=?").run(user.id);
    if (mode === "dormant") db.prepare("UPDATE users SET dormant_at=? WHERE id=?").run(Date.now(), user.id);
    if (mode === "banned") db.prepare("UPDATE users SET is_banned=1 WHERE id=?").run(user.id);
    if (mode === "suspended") db.prepare("UPDATE users SET suspended_until=? WHERE id=?").run(Date.now() + 60_000, user.id);
    assert.throws(authorized.assertCurrentSession, (error) => [401, 403].includes(error.status), mode);
    if (mode === "logout" || mode === "expiry") {
      const current = await request(sibling);
      assert.equal(current.assertCurrentSession().id, user.id, "another valid session is independently authorized");
    }
  }
});

test("different accounts remain independently authorized and identity-bound", async () => {
  const a = member();
  const b = member();
  const sa = createSession(a.id);
  const sb = createSession(b.id);
  const [ra, rb] = await Promise.all([request(sa, { expectedAccount: a.id }), request(sb, { expectedAccount: b.id })]);
  destroySession(sa.token);
  assert.throws(ra.assertCurrentSession, (error) => error.status === 401);
  assert.equal(rb.assertCurrentSession().id, b.id);
  await assert.rejects(request(sb, { expectedAccount: a.id }), (error) => error.code === "IDENTITY_CHANGED");
  assert.equal(routes["POST /api/posts"]({ ...rb, ip: "independent-account" }).post.userId, b.id);
});

test("role changes invalidate captured authority before a long-running request can commit", async () => {
  for (const [before, after] of [["admin", "fan"], ["moderator", "fan"], ["fan", "admin"]]) {
    const user = member();
    db.prepare("UPDATE users SET role=? WHERE id=?").run(before, user.id);
    const session = createSession(user.id);
    const authorized = await request(session);
    assert.equal(authorized.user.role, before);
    db.prepare("UPDATE users SET role=? WHERE id=?").run(after, user.id);
    assert.equal(getSession(session.token)?.user_id, user.id, "the role fence must not rely on incidental token expiry");
    assert.throws(authorized.assertCurrentSession,
      (error) => error.status === 401 && error.code === "AUTH_REQUIRED");
    assert.throws(() => routes["POST /api/posts"]({ ...authorized, ip: `changed-role-${user.id}` }),
      (error) => error.status === 401 && error.code === "AUTH_REQUIRED");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM posts WHERE user_id=?").get(user.id).n, 0);
    assert.equal(db.isTransaction, false);
    const fresh = await request(session);
    assert.equal(fresh.assertCurrentSession().role, after, "new requests use current authority");
  }
});

test("profile and venue publication transactions refuse a session revoked after request authorization", async () => {
  for (const [route, pathname, payload, params] of [
    ["PATCH /api/me", "/api/me", { bio: "Changed after logout" }, {}],
    ["POST /api/venues/:key/reviews", "/api/venues/test-room/reviews", { rating: 4, text: "Changed after logout" }, { key: "test-room" }],
  ]) {
    const user = member();
    const session = createSession(user.id);
    const authorized = await request(session, { method: route.split(" ")[0], pathname, readBody: () => payload });
    destroySession(session.token);
    assert.throws(() => routes[route]({ ...authorized, ip: `late-${user.id}`, params }),
      (error) => error.code === "AUTH_REQUIRED", route);
    assert.equal(q.userById.get(user.id).bio, user.bio);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM venue_reviews WHERE user_id=?").get(user.id).n, 0);
    assert.equal(db.isTransaction, false);
  }
});

test("provider-backed artist writes revalidate the original session under their writer transaction", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const [mode, privileged] of [["logout", false], ["unverified", false], ["demotion", true], ["expiry", true]]) {
      const user = member();
      if (privileged) db.prepare("UPDATE users SET role='admin' WHERE id=?").run(user.id);
      const session = createSession(user.id);
      const name = `Guarded Artist ${sequence}`;
      const mbid = `77777777-7777-4777-8777-${String(sequence).padStart(12, "0")}`;
      const pathname = privileged ? "/api/admin/artists/enrich" : "/api/artists/resolve";
      const payload = privileged ? { names: [name] } : { name, mbid };
      const authorized = await request(session, { pathname, readBody: () => payload });
      let changed = false;
      let guardedWrite = false;
      globalThis.fetch = async (url) => {
        if (!changed) {
          changed = true;
          if (mode === "logout") destroySession(session.token);
          if (mode === "unverified") db.prepare("UPDATE users SET email_verified_at=0 WHERE id=?").run(user.id);
          if (mode === "demotion") db.prepare("UPDATE users SET role='fan' WHERE id=?").run(user.id);
          if (mode === "expiry") db.prepare("UPDATE sessions SET expires_at=0 WHERE user_id=?").run(user.id);
        }
        if (String(url).includes("musicbrainz.org/ws/2/artist")) {
          return new Response(JSON.stringify({ artists: [{ id: mbid, name, score: 100 }] }));
        }
        if (String(url).includes("api.deezer.com/search/artist")) {
          return new Response(JSON.stringify({ data: [{ id: 9876543, name, nb_fan: 1000 }] }));
        }
        if (String(url).includes("api.deezer.com/artist/9876543/top")) {
          return new Response(JSON.stringify({ data: [] }));
        }
        throw new Error("Unexpected fixture provider request");
      };
      await assert.rejects(routes[`POST ${pathname}`]({ ...authorized, ip: `artist-${user.id}`,
        assertCurrentSession() {
          guardedWrite ||= db.isTransaction;
          return authorized.assertCurrentSession();
        } }), (error) => ["AUTH_REQUIRED", "EMAIL_VERIFICATION_REQUIRED"].includes(error.code), mode);
      assert.equal(changed, true, "the real provider boundary must have yielded");
      assert.equal(guardedWrite, true, "authorization must be checked inside the database write transaction");
      assert.equal(artistStmts.byNorm.get(name.toLowerCase()), undefined, "no catalog write after revoked authority");
      assert.equal(db.isTransaction, false);
    }
  } finally { globalThis.fetch = originalFetch; }
});
