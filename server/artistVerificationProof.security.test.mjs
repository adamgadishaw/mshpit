import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pit-artist-proof-security-"));
process.env.PIT_DATA_DIR = directory;
delete process.env.RESEND_API_KEY;
delete process.env.MAIL_FROM;
const { db, q, artistStmts, publicUser } = await import("./db.js");
const { routes, ApiError } = await import("./api.js");
const { resetRateLimitsForTests } = await import("./auth.js");
const { seoHttpPlan } = await import("./seo.js");
const { visibleTourDateRowsFrom } = await import("./tourDateVisibilityQuery.js");
let sequence = 0;
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
beforeEach(() => resetRateLimitsForTests());

function member({ role = "fan", emailVerified = true } = {}) {
  const id = `proof_guard_${++sequence}`;
  q.insertUser.run(id, `${id}@example.test`, "Independent Member", id, "fixture-hash", role,
    "Toronto", 43.65, -79.38, "IM", "#123456", Date.now());
  if (emailVerified) db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(Date.now(), id);
  return q.userById.get(id);
}
const context = (user, body = {}, extra = {}) => ({ user, body, query: {}, ip: user?.id || `proof-guest-${++sequence}`, ...extra });
const invoke = (route, user, body, extra) => routes[route](context(user, body, extra));
const rejected = (run, statuses = [400, 403, 409]) => assert.rejects(async () => await run(),
  error => statuses.includes(error.status), `Expected a bounded client/permission failure (${statuses.join(",")})`);
function page() {
  const owner = member();
  const created = invoke("POST /api/artist-pages", owner, { artistName: `Proof Garden Ensemble ${++sequence}`,
    bio: "An independent Toronto live music project creating original songs and playing intimate local concert rooms with community musicians." });
  return { owner: q.userById.get(owner.id), artist: created.artist };
}
function challenge(owner, artistName, instagramHandle = `local.act${++sequence}`, extra = {}) {
  return invoke("POST /api/artist-verification-challenges", owner, { artistName, method: "instagram_story", instagramHandle, ...extra }).challenge;
}
function submit(owner, proof, extra = {}) {
  return invoke("POST /api/artist-requests", owner, { artistName: proof.artistName, method: "instagram_story",
    challengeId: proof.id, storyUrl: `https://www.instagram.com/stories/${proof.instagramHandle}/123456789012345/`,
    note: "Please independently inspect our artist account and currently published Story.", ...extra });
}
const reviewBody = (proof, extra = {}) => ({ method: "instagram_story", reason: "Reviewed the official artist account and matching live Story.",
  officialAccountConfirmed: true, ownershipConfirmed: true, liveCodeObserved: true,
  observedCode: proof.code, observedAt: Date.now(), ...extra });
const approve = (admin, request, body) => invoke("POST /api/admin/artist-requests/:id/approve", admin, body, { params: { id: request.id } });
const identityDecision = (admin, artist, action, extra = {}) => invoke("POST /api/admin/artists/:key/identity-review", admin,
  { action, reason: "Independently reviewed this artist identity and ownership.", ...extra }, { params: { key: encodeURIComponent(artist.key) } });

test("Story proof is private and owner-bound, and never automatically grants identity or a check", async () => {
  const owner = member();
  const other = member();
  const name = `Unsigned Proof Act ${++sequence}`;
  const headers = {};
  const result = invoke("POST /api/artist-verification-challenges", owner,
    { artistName: name, method: "instagram_story", instagramHandle: "@Local.Proof", userId: other.id, verified: true },
    { setHeader(name, value) { headers[name] = value; } });
  const proof = result.challenge;
  assert.equal(result.ok, true);
  assert.equal(proof.instagramHandle, "local.proof");
  assert.equal(headers["Cache-Control"], "private, no-store");
  assert.ok(proof.code.length >= 8);
  assert.ok(proof.expiresAt > Date.now() && proof.expiresAt <= Date.now() + 24 * 60 * 60 * 1000);
  assert.equal(db.prepare("SELECT user_id FROM artist_verification_challenges WHERE id=?").get(proof.id).user_id, owner.id);
  assert.equal(q.userById.get(owner.id).role, "fan");
  assert.equal(q.userById.get(owner.id).verified, 0);
  assert.equal(artistStmts.byNorm.get(name.toLowerCase()), undefined);
  assert.equal(JSON.stringify(publicUser(q.userById.get(owner.id))).includes(proof.code), false);
  assert.equal(JSON.stringify(invoke("GET /api/artist-account", other, { userId: owner.id })).includes(proof.code), false);
  await rejected(() => invoke("POST /api/artist-verification-challenges", null,
    { artistName: name, method: "instagram_story", instagramHandle: "local.proof" }), [401]);
  const unconfirmed = member({ emailVerified: false });
  await rejected(() => challenge({ ...unconfirmed, email_verified_at: Date.now() }, name), [403]);
});

test("same active normalized proof is reused, account changes rotate it and generation is capped", async () => {
  const { owner, artist } = page();
  const first = challenge(owner, artist.name, "@Local.One");
  assert.equal(challenge(owner, artist.name, "local.one").id, first.id);
  const second = challenge(owner, artist.name, "local.two");
  assert.notEqual(second.id, first.id);
  await rejected(() => submit(owner, first));
  const third = challenge(owner, artist.name, "local.three");
  assert.notEqual(third.id, second.id);
  await rejected(() => challenge(owner, artist.name, "local.four"), [429]);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM artist_verification_challenges WHERE user_id=?").get(owner.id).n, 3);
});

test("challenge ownership, requested artist and Instagram URL are all checked on submission", async () => {
  const { owner, artist } = page();
  const other = member();
  const proof = challenge(owner, artist.name, "local.identity");
  await rejected(() => submit(other, proof), [400, 403, 404, 409]);
  await rejected(() => submit(owner, proof, { artistName: `Different Act ${++sequence}` }));
  for (const storyUrl of [
    "https://instagram.com/stories/someone.else/12345/",
    "https://instagram.com.evil.example/stories/local.identity/12345/",
    "https://instagram.com@evil.example/stories/local.identity/12345/",
    "http://instagram.com/stories/local.identity/12345/",
    "https://instagram.com/p/12345/",
    "https://instagram.com/stories/local.identity/not-a-story/",
  ]) {
    resetRateLimitsForTests();
    await rejected(() => submit(owner, proof, { storyUrl }));
  }
  resetRateLimitsForTests();
  assert.equal(db.prepare("SELECT COUNT(*) n FROM artist_requests WHERE user_id=?").get(owner.id).n, 0);
  assert.equal(submit(owner, proof).status, "pending");
  assert.equal(q.userById.get(owner.id).verified, 0);
});

test("expired proofs and revoked sessions cannot create requests or challenge state", async () => {
  const { owner, artist } = page();
  const proof = challenge(owner, artist.name);
  db.prepare("UPDATE artist_verification_challenges SET created_at=?,expires_at=? WHERE id=?")
    .run(Date.now() - 2 * 86400000, Date.now() - 86400000, proof.id);
  await rejected(() => submit(owner, proof));
  const stale = new ApiError(401, "The active account changed.", "AUTH_REQUIRED");
  const before = db.prepare("SELECT COUNT(*) n FROM artist_verification_challenges WHERE user_id=?").get(owner.id).n;
  assert.throws(() => invoke("POST /api/artist-verification-challenges", owner,
    { artistName: artist.name, method: "instagram_story", instagramHandle: "fresh.proof" },
    { assertCurrentSession() { throw stale; } }), error => error === stale);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM artist_verification_challenges WHERE user_id=?").get(owner.id).n, before);
});

test("only an admin with explicit live evidence can approve, and approval replay cannot restore a revoked check", async () => {
  const { owner, artist } = page();
  const proof = challenge(owner, artist.name);
  const request = submit(owner, proof);
  const moderator = member({ role: "moderator" });
  const admin = member({ role: "admin" });
  await rejected(() => approve(owner, request, reviewBody(proof)), [403]);
  await rejected(() => approve(moderator, request, reviewBody(proof)), [403]);
  for (const body of [
    {}, reviewBody(proof, { officialAccountConfirmed: false }), reviewBody(proof, { ownershipConfirmed: false }),
    reviewBody(proof, { liveCodeObserved: false }), reviewBody(proof, { observedCode: `${proof.code}WRONG` }),
    reviewBody(proof, { observedAt: Date.now() + 86400000 }), reviewBody(proof, { observedAt: 1 }),
    reviewBody(proof, { reason: "ok" }),
  ]) {
    await rejected(() => approve(admin, request, body));
    assert.equal(q.userById.get(owner.id).verified, 0);
  }
  assert.equal(approve(admin, request, reviewBody(proof)).ok, true);
  assert.equal(q.userById.get(owner.id).verified, 1);
  db.prepare("UPDATE users SET verified=0 WHERE id=?").run(owner.id);
  await rejected(() => approve(admin, request, reviewBody(proof)), [409]);
  assert.equal(q.userById.get(owner.id).verified, 0);
});

test("approval rechecks proof expiry, requested artist and current account state", async () => {
  for (const change of ["expiry", "artist", "banned", "email"]) {
    const { owner, artist } = page();
    const proof = challenge(owner, artist.name);
    const request = submit(owner, proof);
    const admin = member({ role: "admin" });
    if (change === "expiry") db.prepare("UPDATE artist_verification_challenges SET created_at=?,expires_at=? WHERE id=?")
      .run(Date.now() - 2 * 86400000, Date.now() - 86400000, proof.id);
    if (change === "artist") db.prepare("UPDATE artist_requests SET artist_name=? WHERE id=?").run("Changed Identity", request.id);
    if (change === "banned") db.prepare("UPDATE users SET is_banned=1 WHERE id=?").run(owner.id);
    if (change === "email") db.prepare("UPDATE users SET email_verified_at=0 WHERE id=?").run(owner.id);
    await rejected(() => approve(admin, request, reviewBody(proof)), [400, 403, 409]);
    assert.equal(q.userById.get(owner.id).verified, 0, change);
    assert.equal(db.prepare("SELECT owner_id FROM artist_profiles WHERE artist_key=?").get(artist.key).owner_id, owner.id);
  }
});

test("rejecting proof records feedback, revokes that challenge and permits a fresh proof without waiting for expiry", async () => {
  const { owner, artist } = page();
  const proof = challenge(owner, artist.name, "local.recheck");
  const request = submit(owner, proof);
  const admin = member({ role: "admin" });
  invoke("POST /api/admin/artist-requests/:id/reject", admin,
    { reason: "The linked account was not established as the official artist account." }, { params: { id: request.id } });
  assert.equal(db.prepare("SELECT status FROM artist_verification_challenges WHERE id=?").get(proof.id).status, "revoked");
  await rejected(() => submit(owner, proof));
  const replacement = challenge(owner, artist.name, "local.recheck");
  assert.notEqual(replacement.id, proof.id);
  assert.notEqual(replacement.code, proof.code);
  assert.equal(submit(owner, replacement).status, "pending");
  assert.equal(q.userById.get(owner.id).verified, 0);
});

test("an expired pending review is superseded by fresh evidence instead of trapping the account", async () => {
  const { owner, artist } = page();
  const first = challenge(owner, artist.name, "local.renewal");
  const previous = submit(owner, first);
  db.prepare("UPDATE artist_verification_challenges SET created_at=?,expires_at=? WHERE id=?")
    .run(Date.now() - 2 * 86400000, Date.now() - 86400000, first.id);
  const next = challenge(owner, artist.name, "local.renewal");
  assert.notEqual(next.id, first.id);
  const current = submit(owner, next);
  assert.notEqual(current.id, previous.id);
  assert.equal(db.prepare("SELECT status FROM artist_requests WHERE id=?").get(previous.id).status, "rejected");
  assert.equal(db.prepare("SELECT status FROM artist_requests WHERE id=?").get(current.id).status, "pending");
  assert.equal(q.userById.get(owner.id).verified, 0);
});

test("manual evidence needs explicit review and cannot transfer an occupied artist page", async () => {
  const { owner, artist } = page();
  const claimant = member();
  const request = invoke("POST /api/artist-requests", claimant,
    { artistName: artist.name, method: "manual", note: "Our manager can supply public official artist evidence." });
  const admin = member({ role: "admin" });
  const body = { method: "manual", reason: "Manually reviewed the official artist contact and identity.",
    officialAccountConfirmed: true, ownershipConfirmed: true, reviewedUrl: "https://artist.example/official" };
  await rejected(() => approve(admin, request, body), [409]);
  assert.equal(q.userById.get(claimant.id).role, "fan");
  assert.equal(q.userById.get(claimant.id).verified, 0);
  assert.equal(db.prepare("SELECT owner_id FROM artist_profiles WHERE artist_key=?").get(artist.key).owner_id, owner.id);
});

test("a same-script protected artist cannot be duplicated and a lookalike page starts on hold", async () => {
  const plain = member();
  await rejected(() => invoke("POST /api/artist-pages", plain, { artistName: "Drake" }), [409]);
  assert.equal(q.userById.get(plain.id).role, "fan");
  const owner = member();
  const result = invoke("POST /api/artist-pages", owner, { artistName: "Dr\u0430ke" });
  assert.equal(result.identityReview.held, true);
  assert.equal(result.user.id, owner.id);
  assert.equal(result.user.verified, false);
  assert.equal(result.profile.ownerId, owner.id);
  assert.equal(seoHttpPlan(`/artist/${artistStmts.byNorm.get(result.artist.key).public_slug}`).status, 404);
  assert.equal(invoke("GET /api/artists", null, {}, { query: { q: result.artist.name } }).artists.some(row => row.key === result.artist.key), false);
});

test("an identity hold withdraws authored publication, and releasing it cannot silently grant a badge or revive posts", async () => {
  const { owner, artist } = page();
  const viewer = member();
  const admin = member({ role: "admin" });
  const moderator = member({ role: "moderator" });
  const posted = invoke("POST /api/posts", owner, { kind: "status", review: "Our first independently released concert update." });
  const dates = [{ venue: "Independent Music Hall", place: "Toronto, Canada", date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) }];
  const concert = invoke("POST /api/tourdates", owner, { dates }).tourDates[0];
  await rejected(() => identityDecision(owner, artist, "hold"), [403]);
  await rejected(() => identityDecision(moderator, artist, "hold"), [403]);
  identityDecision(admin, artist, "hold");
  assert.equal(invoke("GET /api/artist-account", owner).identityReview.held, true);
  const heldOwner = q.userById.get(owner.id);
  const publicAccount = publicUser(heldOwner);
  assert.equal(publicAccount.role, "fan", "ordinary public account projections must not advertise a held artist identity");
  assert.equal(publicAccount.artistName, undefined);
  assert.equal(publicAccount.verified, false);
  assert.equal(publicAccount.identityReview, undefined);
  assert.equal(publicUser(heldOwner, { self: true }).role, "artist");
  assert.equal(publicUser(heldOwner, { self: true }).artistName, artist.name);
  assert.equal(invoke("GET /api/artists/:key/profile", owner, {}, { params: { key: encodeURIComponent(artist.key) } }).profile.ownerId, owner.id,
    "the owner retains a private management preview while public publication is held");
  invoke("PATCH /api/artists/:key/profile", owner, { bio: "Draft artist biography corrected during identity review." },
    { params: { key: encodeURIComponent(artist.key) } });
  assert.equal(invoke("GET /api/artists", viewer, {}, { query: { q: artist.name } }).artists.some(row => row.key === artist.key), false);
  assert.equal(invoke("GET /api/feed", viewer).posts.some(row => row.id === posted.id), false);
  assert.equal(visibleTourDateRowsFrom(db, null, { id: concert.id }).length, 0);
  assert.equal(seoHttpPlan(`/artist/${artistStmts.byNorm.get(artist.key).public_slug}`).status, 404);
  for (const staff of [moderator, admin]) {
    await rejected(() => invoke("POST /api/admin/moderation/actions", staff,
      { action: "restore", targetType: "post", targetId: posted.id, reason: "Attempting ordinary content restoration during the identity hold." }), [409]);
    await rejected(() => invoke("POST /api/admin/content/:type/:id", staff,
      { removed: false, reason: "Attempting legacy restoration during the identity hold." }, { params: { type: "post", id: posted.id } }), [409]);
    assert.equal(db.prepare("SELECT removed FROM posts WHERE id=?").get(posted.id).removed, 1);
  }
  await rejected(() => invoke("POST /api/admin/users/:id/verified", admin,
    { verified: true, reason: "Trying the generic badge control." }, { params: { id: owner.id } }), [409]);
  await rejected(() => invoke("POST /api/admin/users/:id/verified", moderator,
    { verified: true }, { params: { id: owner.id } }), [403]);
  await rejected(() => invoke("POST /api/posts", owner, { kind: "status", review: "Attempted new publication during review." }), [403, 409]);
  await rejected(() => invoke("POST /api/tourdates", owner, { dates }), [403, 409]);
  await rejected(() => identityDecision(admin, artist, "release"));
  identityDecision(admin, artist, "release", { identityReviewConfirmed: true,
    officialAccountConfirmed: true, ownershipConfirmed: true, reviewedUrl: "https://artist.example/official" });
  assert.equal(invoke("GET /api/artist-account", owner).identityReview.held, false);
  assert.equal(q.userById.get(owner.id).verified, 0);
  assert.equal(db.prepare("SELECT removed FROM posts WHERE id=?").get(posted.id).removed, 1);
});

test("admin identity lookup finds clear, held and rejected owned pages without publishing private verification proof", async (t) => {
  const clear = page();
  const held = page();
  const denied = page();
  const admin = member({ role: "admin" });
  const moderator = member({ role: "moderator" });
  const fan = member();
  const proof = challenge(held.owner, held.artist.name, "private.identity.proof");
  submit(held.owner, proof);
  identityDecision(admin, held.artist, "hold");
  identityDecision(admin, denied.artist, "reject");
  let fetches = 0;
  t.mock.method(globalThis, "fetch", async () => { fetches += 1; throw new Error("Identity lookup must remain local"); });
  const route = "GET /api/admin/artist-identities";
  for (const actor of [fan, moderator, held.owner]) {
    await rejected(() => invoke(route, actor, {}, { query: { q: held.artist.name } }), [403]);
  }
  await rejected(() => invoke(route, null, {}, { query: { q: held.artist.name } }), [401, 403]);
  for (const [fixture, status] of [[clear, "clear"], [held, "pending"], [denied, "rejected"]]) {
    const headers = {};
    const result = await invoke(route, admin, {}, { query: { q: fixture.artist.name },
      setHeader(name, value) { headers[name] = value; } });
    assert.equal(headers["Cache-Control"], "private, no-store");
    const found = result.artists.find(row => row.key === fixture.artist.key);
    assert.ok(found, `admin must find ${status} owned artist pages`);
    assert.equal(found.ownerId, fixture.owner.id);
    assert.equal(found.identityReview.status, status);
    assert.equal(found.identityReview.held, status !== "clear");
    assert.equal(JSON.stringify(result).includes(proof.code), false);
    assert.equal(JSON.stringify(result).includes(proof.instagramHandle), false);
    assert.equal(found.verificationChallenge, undefined);
    assert.equal(found.evidence, undefined);
    assert.equal(found.email, undefined);
  }
  assert.equal(fetches, 0, "administrative identity lookup must never invoke external providers");
});
