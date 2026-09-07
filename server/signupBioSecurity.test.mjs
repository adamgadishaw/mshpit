import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { LEGAL_ACCEPTANCE_VERSION } from "../src/domain/privacyDisclosures.mjs";
import { assertAccountMutationAccess } from "./accountMutationAccess.js";
import { renderPublicDocumentHead, renderPublicDocumentMain } from "./features/seo/publicDocumentRenderer.js";

// Imports must use a fresh fixture database, never the developer account store.
const directory = mkdtempSync(join(tmpdir(), "pit-signup-bio-security-"));
process.env.PIT_DATA_DIR = directory;
process.env.PIT_ALLOW_EMPTY_DB_BOOTSTRAP = "true";
process.env.EMAIL_VERIFICATION_ENABLED = "true";
delete process.env.RESEND_API_KEY;
delete process.env.MAIL_FROM;
const { db, q } = await import("./db.js");
const { routes } = await import("./api.js");
const { createSession, getSession, hashPassword, resetRateLimitsForTests } = await import("./auth.js");
const { mintVerifyToken } = await import("./verification.js");
after(() => {
  db.close();
  const target = realpathSync(directory);
  assert.equal(dirname(target), realpathSync(tmpdir()));
  assert.ok(basename(target).startsWith("pit-signup-bio-security-"));
  rmSync(target, { recursive: true, force: true });
});
beforeEach(() => resetRateLimitsForTests());
let sequence = 0;
function context(body = {}, user = null, params = {}) {
  const ctx = { body, user, params, query: {}, ip: `signup-bio-security-${++sequence}`, ua: "isolated-test",
    setHeader() {}, setSession(value) { ctx.session = value; }, clearSession() { ctx.cleared = true; } };
  return ctx;
}
function member({ role = "fan", verified = true } = {}) {
  const id = `bio_security_${++sequence}`;
  q.insertUser.run(id, `${id}@example.test`, "Fixture Member", id, hashPassword("fixture-password1"), role,
    null, null, null, "FM", "#123456", Date.now());
  db.prepare("UPDATE users SET email_verified_at=?,age_band='18_plus' WHERE id=?").run(verified ? Date.now() : 0, id);
  return q.userById.get(id);
}
function signupBody(email, extra = {}) {
  return { name: "Fixture New Member", email, password: "fixture-password2", genres: ["Rock"],
    ageBand: "18_plus", termsVersion: LEGAL_ACCEPTANCE_VERSION, ...extra };
}

test("profile SQL-looking text stays literal and cannot forge privileged account fields", () => {
  const owner = member({ role: "admin" }), author = member();
  const ownerBefore = { ...q.userById.get(owner.id) };
  const bio = "O'Malley & friends; UPDATE users SET role='admin'; -- <b>live music</b>";
  const result = routes["PATCH /api/me"](context({ bio, id: owner.id, userId: owner.id, role: "admin",
    email: owner.email, email_verified_at: Date.now(), onboardingVersion: 1, isOwner: true }, author));
  assert.equal(result.user.id, author.id);
  assert.equal(result.user.bio, bio);
  const stored = q.userById.get(author.id);
  assert.equal(stored.bio, bio);
  assert.equal(stored.role, "fan");
  assert.equal(stored.email, author.email);
  assert.equal(stored.onboarding_version, author.onboarding_version);
  assert.deepEqual({ ...q.userById.get(owner.id) }, ownerBefore);
});

test("stored bio markup is escaped in public profile HTML, metadata, and JSON-LD", () => {
  const author = member();
  const bio = '</script><script>alert("bio")</script><img src=x onerror=alert(1)>&';
  const { user } = routes["PATCH /api/me"](context({ bio }, author));
  assert.equal(q.userById.get(author.id).bio, bio, "literal text can be preserved and rendered safely");
  const document = { kind: "member", member: { ...user, avatar: null }, posts: [],
    stats: { postCount: 0, followerCount: 0 }, breadcrumbs: [],
    canonicalUrl: "https://example.test/u/fixture", title: user.name, description: user.bio,
    jsonLd: [{ "@context": "https://schema.org", "@type": "Person", description: user.bio }] };
  const main = renderPublicDocumentMain(document), head = renderPublicDocumentHead(document);
  assert.doesNotMatch(main, /<script\b|<img\b/i);
  assert.ok(main.includes("&lt;script&gt;"));
  assert.ok(main.includes("&quot;bio&quot;"));
  assert.ok(main.includes("&lt;img src=x onerror=alert(1)&gt;&amp;"));
  assert.equal((head.match(/<script\b/g) || []).length, 1, "only the intended JSON-LD element exists");
  assert.ok(head.includes("\\u003c/script\\u003e"));
  assert.doesNotMatch(head, /<script>alert|<img\b/i);
});

test("unsafe bio URL schemes fail atomically before profile persistence", () => {
  const author = member();
  for (const bio of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "java\u200bscript:alert(1)",
    "vbscript:msgbox(1)", "data:text/html,<script>alert(1)</script>", "file:///private/example"]) {
    const before = { ...q.userById.get(author.id) };
    assert.throws(() => routes["PATCH /api/me"](context({ name: "Changed Name", bio }, author)),
      (error) => error.status === 422 && error.code === "CONTENT_REJECTED" && !error.message.includes(bio));
    assert.deepEqual({ ...q.userById.get(author.id) }, before);
  }
});

test("bio edits cannot smuggle executable or unowned profile media", () => {
  const author = member();
  for (const avatarUri of ["javascript:alert(1)", "data:image/svg+xml,<svg onload=alert(1)>",
    "https://unowned.example.test/avatar.svg"]) {
    const before = { ...q.userById.get(author.id) };
    assert.throws(() => routes["PATCH /api/me"](context({ bio: "Do not partially save", avatarUri }, author)),
      (error) => Number(error.status) >= 400 && Number(error.status) < 500);
    assert.deepEqual({ ...q.userById.get(author.id) }, before);
  }
});

test("signup ignores forged authority and cannot use Owner as the new account", () => {
  const owner = member({ role: "admin" });
  const ownerSession = createSession(owner.id), ownerBefore = { ...q.userById.get(owner.id) };
  const email = `fresh-bio-security-${++sequence}@example.test`;
  const ctx = context(signupBody(email, { role: "admin", id: owner.id, emailVerified: true,
    email_verified_at: Date.now(), onboardingVersion: 1, isOwner: true }), owner);
  routes["POST /api/signup"](ctx);
  const created = q.userByEmail.get(email);
  assert.ok(created);
  assert.notEqual(created.id, owner.id);
  assert.equal(created.role, "fan");
  assert.equal(created.email_verified_at, 0);
  assert.equal(created.onboarding_version, 0);
  assert.deepEqual({ ...q.userById.get(owner.id) }, ownerBefore);
  assert.equal(getSession(ownerSession.token).user_id, owner.id);
  if (ctx.session) assert.equal(getSession(ctx.session.token).user_id, created.id);
});

test("a second account's verification and cancellation cannot change or delete Owner", () => {
  const owner = member({ role: "admin" });
  const ownerSession = createSession(owner.id), ownerBefore = { ...q.userById.get(owner.id) };
  const creation = context(signupBody(owner.email, { addAccount: true, currentPassword: "fixture-password1" }), owner);
  const result = routes["POST /api/signup"](creation);
  const second = q.usersByEmail.all(owner.email).find((user) => user.id !== owner.id);
  assert.ok(second);
  assert.equal(second.role, "fan");
  assert.equal(second.email_verified_at, 0);
  const verification = context({ token: mintVerifyToken(second.id) }, owner);
  assert.equal(routes["POST /api/verify-email"](verification).verified, true);
  assert.equal(verification.session, undefined, "email confirmation must not replace Owner's session");
  assert.ok(q.userById.get(second.id).email_verified_at > 0);
  assert.equal(q.userById.get(second.id).onboarding_version, 0, "verification is not setup completion");
  routes["POST /api/signup/cancel"](context({ cancelToken: result.cancelToken }, owner));
  assert.equal(q.userById.get(second.id), undefined);
  assert.deepEqual({ ...q.userById.get(owner.id) }, ownerBefore);
  assert.equal(getSession(ownerSession.token).user_id, owner.id);
});

test("every registered write route is verification-gated unless it is an explicit account-rights exception", () => {
  const rights = new Set([
    "POST /api/signup", "POST /api/login", "POST /api/logout", "POST /api/forgot", "POST /api/reset",
    "POST /api/verify-email", "POST /api/verify-email/resend", "POST /api/signup/cancel",
    "POST /api/me/password", "POST /api/me/onboarding/complete", "POST /api/me/export",
    "POST /api/me/email-preferences", "POST /api/me/analytics-consent", "POST /api/unsubscribe",
    "POST /api/me/accounts/connect", "POST /api/me/accounts/switch", "DELETE /api/me",
    "POST /api/reports", "POST /api/tracks/report", "POST /api/users/:id/block", "POST /api/users/:id/mute",
    "DELETE /api/media/assets/:id",
  ]);
  const user = { id: "route-coverage-only", email_verified_at: 0, role: "fan" };
  let checked = 0;
  for (const route of Object.keys(routes)) {
    const [method, pathname] = route.split(" ");
    if (["GET", "HEAD", "OPTIONS"].includes(method)) continue;
    checked++;
    const request = { method, pathname, user, body: { bio: "This public edit must be gated" } };
    if (rights.has(route)) assert.equal(assertAccountMutationAccess(request), true, route);
    else assert.throws(() => assertAccountMutationAccess(request),
      (error) => error.status === 403 && ["EMAIL_VERIFICATION_REQUIRED", "MEDIA_EMAIL_VERIFICATION_REQUIRED"].includes(error.code), route);
  }
  assert.ok(checked > 75, "exercise the live route registry, including future writers");
});

test("verification gates real bio and DM handlers before persistence but permits a verified bio edit", () => {
  const author = member({ verified: false }), recipient = member();
  const before = { ...q.userById.get(author.id) };
  const dispatch = (method, pathname, route, ctx) => {
    // Mirrors the HTTP boundary's order; a route-only unit test would omit it.
    assertAccountMutationAccess({ method, pathname, user: ctx.user, body: ctx.body });
    return routes[route](ctx);
  };
  for (const [method, pathname, route, ctx] of [
    ["PATCH", "/api/me", "PATCH /api/me", context({ bio: "Unverified public edit", role: "admin" }, author)],
    ["POST", `/api/dms/${recipient.id}`, "POST /api/dms/:otherId", context({ text: "Unverified message" }, author, { otherId: recipient.id })],
  ]) assert.throws(() => dispatch(method, pathname, route, ctx),
    (error) => error.status === 403 && error.code === "EMAIL_VERIFICATION_REQUIRED");
  assert.deepEqual({ ...q.userById.get(author.id) }, before);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM dms WHERE from_id=?").get(author.id).n, 0);
  const privacy = dispatch("PATCH", "/api/me", "PATCH /api/me", context({ theme: "stage", profileAudience: "only_me" }, author));
  assert.equal(privacy.user.profileAudience, "only_me");
  assert.equal(q.userById.get(author.id).bio, before.bio);
  routes["POST /api/verify-email"](context({ token: mintVerifyToken(author.id) }, author));
  const saved = dispatch("PATCH", "/api/me", "PATCH /api/me", context({ bio: "Verified public edit" }, q.userById.get(author.id)));
  assert.equal(saved.user.bio, "Verified public edit");
});
