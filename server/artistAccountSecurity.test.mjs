import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pit-artist-account-security-"));
process.env.PIT_DATA_DIR = directory;
const { db, q, artistStmts, artistRow, publicUser } = await import("./db.js");
const { routes, ApiError } = await import("./api.js");
let sequence = 0;
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

function member({ role = "fan", emailVerified = true } = {}) {
  const id = `account_security_${++sequence}`;
  q.insertUser.run(id, `${id}@example.com`, id, id, "fixture-hash", role, "Toronto", 43.65, -79.38, "AS", "#123456", Date.now());
  if (emailVerified) db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(Date.now(), id);
  return q.userById.get(id);
}
const context = (user, body = {}, extra = {}) => ({ user, body, ip: user?.id || `guest-${++sequence}`, query: {}, ...extra });
const create = (user, name = `Independent Act ${++sequence}`, extra = {}) => routes["POST /api/artist-pages"](context(user, { artistName: name, ...extra }));
const failure = (run, status, code) => assert.throws(run, error => error instanceof ApiError && error.status === status && (!code || error.code === code));

test("artist creation requires authenticated, active and email-confirmed membership, not a client role flag", () => {
  failure(() => create(null), 401, "AUTH_REQUIRED");
  const unconfirmed = member({ emailVerified: false });
  failure(() => create({ ...unconfirmed, email_verified_at: Date.now(), role: "artist" }), 403, "EMAIL_VERIFICATION_REQUIRED");
  const banned = member();
  db.prepare("UPDATE users SET is_banned=1 WHERE id=?").run(banned.id);
  failure(() => create(banned), 403);
  failure(() => create(member({ role: "admin" })), 403);
});

test("one free artist page uses the same account, no provider call, no automatic verified check and an idempotent retry", () => {
  const user = member();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("Artist creation must use saved local data"); };
  try {
    const name = `No Provider Band ${++sequence}`;
    const first = create(user, name, { bio: "Our own artist biography.", verified: true, role: "admin", ownerId: "forged" });
    assert.equal(first.user.id, user.id);
    assert.equal(first.user.role, "artist");
    assert.equal(first.user.verified, false);
    assert.equal(first.verification.status, "not_requested");
    assert.equal(first.profile.bio, "Our own artist biography.");
    assert.equal(db.prepare("SELECT owner_id FROM artist_profiles WHERE artist_key=?").get(first.artist.key).owner_id, user.id);
    assert.equal(artistStmts.byNorm.get(first.artist.key).source, "artist-created");
    assert.equal(artistStmts.byNorm.get(first.artist.key).bio, null);
    assert.equal(create(user, name).artist.key, first.artist.key, "a stale fan context cannot create a second page on retry");
    failure(() => create(user, `Other Band ${sequence}`), 409, "ARTIST_PAGE_LIMIT");
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("existing catalogue or punctuation-folded names cannot be overwritten or claimed by self-creation", () => {
  const name = `Existing Act ${++sequence}`;
  const key = name.toLowerCase();
  artistStmts.upsert.run(artistRow(key, { name, bio: "Trusted catalogue biography." }, "test"));
  failure(() => create(member(), name), 409, "ARTIST_PAGE_EXISTS");
  failure(() => create(member(), name.replaceAll(" ", "-")), 409, "ARTIST_PAGE_EXISTS");
  assert.equal(artistStmts.byNorm.get(key).bio, "Trusted catalogue biography.");
  assert.equal(db.prepare("SELECT owner_id FROM artist_profiles WHERE artist_key=?").get(key), undefined);
});

test("account-switch fencing and cancelled sessions leave no partial artist identities", () => {
  const user = member();
  const name = `Atomic Account Band ${++sequence}`;
  failure(() => create(user, name, { expectedAccountId: "different-account" }), 409, "ACCOUNT_CHANGED");
  const cancelled = new ApiError(401, "Session no longer active", "AUTH_REQUIRED");
  assert.throws(() => routes["POST /api/artist-pages"](context(user, { artistName: name }, {
    assertCurrentSession() { throw cancelled; },
  })), error => error === cancelled);
  assert.equal(artistStmts.byNorm.get(name.toLowerCase()), undefined);
  assert.equal(q.userById.get(user.id).role, "fan");
});

test("artist intent is self-only and the account snapshot cannot be shared-cached or redirected to another user", () => {
  const user = member();
  const other = member();
  const intent = { artistName: `Private Intent ${++sequence}` };
  db.prepare("UPDATE users SET extras=? WHERE id=?").run(JSON.stringify({ pendingArtistIntent: intent }), user.id);
  const headers = {};
  const result = routes["GET /api/artist-account"](context(user, { userId: other.id }, {
    setHeader(name, value) { headers[name] = value; },
  }));
  assert.deepEqual(result.pendingArtistIntent, intent);
  assert.equal(result.user.id, user.id);
  assert.equal(headers["Cache-Control"], "private, no-store");
  assert.equal(JSON.stringify(publicUser(q.userById.get(user.id))).includes(intent.artistName), false);
  failure(() => routes["GET /api/artist-account"](context(null)), 401);
});

test("personalized artist discovery cannot enter a shared cache while guest charts remain public", () => {
  const owner = member();
  const created = create(owner, `Cache Boundary Act ${++sequence}`);
  // A later independently matched provider enrichment can make this local
  // identity chart-eligible without changing its artist-created provenance.
  const spotifyId = "A".repeat(22);
  db.prepare("UPDATE artists SET popularity=100,rank_score=1000000,spotify_id=?,data=? WHERE norm=?")
    .run(spotifyId, JSON.stringify({ name: created.artist.name, spotifyId }), created.artist.key);
  db.prepare("UPDATE users SET profile_audience='only_me' WHERE id=?").run(owner.id);
  const viewer = member();
  for (const path of ["GET /api/discover/chart", "GET /api/discover/overview"]) {
    for (const actor of [q.userById.get(owner.id), viewer, null]) {
      const headers = {};
      const result = routes[path](context(actor, {}, {
        query: { country: "Worldwide" },
        setHeader(name, value) { headers[name] = value; },
      }));
      const rows = result.chart?.rows || result.rows;
      assert.equal(rows.some(row => row.key === created.artist.key), actor?.id === owner.id, path);
      assert.equal(headers["Cache-Control"], actor?.id
        ? "private, no-store"
        : "public, max-age=60, stale-while-revalidate=300", path);
    }
  }
});

test("only staff approval grants a check and replaying an old approval cannot undo revocation", () => {
  const user = member();
  const created = create(user);
  const request = routes["POST /api/artist-requests"](context(q.userById.get(user.id), {
    artistName: created.artist.name, note: "Official website https://artist.example/about", verified: true,
  }));
  assert.equal(request.status, "pending");
  assert.equal(q.userById.get(user.id).verified, 0);
  const approve = actor => routes["POST /api/admin/artist-requests/:id/approve"](context(actor, {
    method: "manual", reason: "Reviewed the official artist website and account ownership.",
    officialAccountConfirmed: true, ownershipConfirmed: true, reviewedUrl: "https://artist.example/about",
  }, { params: { id: request.id } }));
  failure(() => approve(q.userById.get(user.id)), 403);
  const admin = member({ role: "admin" });
  assert.equal(approve(admin).ok, true);
  assert.equal(q.userById.get(user.id).verified, 1);
  db.prepare("UPDATE users SET verified=0 WHERE id=?").run(user.id);
  failure(() => approve(admin), 409, "CONFLICT");
  assert.equal(q.userById.get(user.id).verified, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM moderation_actions WHERE target_id=? AND action='approve_artist_claim'").get(user.id).n, 1);
});

test("approval rechecks account state and cannot steal a newly-owned existing page", () => {
  const owner = member();
  const created = create(owner);
  const attacker = member();
  const request = routes["POST /api/artist-requests"](context(attacker, {
    artistName: created.artist.name, note: "Claim evidence supplied for manual review.",
  }));
  const admin = member({ role: "admin" });
  failure(() => routes["POST /api/admin/artist-requests/:id/approve"](context(admin, {}, { params: { id: request.id } })), 409, "CONFLICT");
  assert.equal(q.userById.get(attacker.id).role, "fan");
  assert.equal(db.prepare("SELECT owner_id FROM artist_profiles WHERE artist_key=?").get(created.artist.key).owner_id, owner.id);
  const another = member();
  const second = routes["POST /api/artist-requests"](context(another, {
    artistName: `Review Later Band ${++sequence}`, note: "Official social profile available for review.",
  }));
  db.prepare("UPDATE users SET email_verified_at=0 WHERE id=?").run(another.id);
  failure(() => routes["POST /api/admin/artist-requests/:id/approve"](context(admin, {}, { params: { id: second.id } })), 409, "CONFLICT");
});

test("a hidden self-created page cannot leak through search/profile/resolve or trigger an upstream replacement", async () => {
  const owner = member();
  const created = create(owner);
  const viewer = member();
  const search = actor => routes["GET /api/artists"](context(actor, {}, { query: { q: created.artist.name, limit: 20 } }));
  assert.equal(search(viewer).artists.some(row => row.key === created.artist.key), true);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("A hidden identity must not be recreated through a provider"); };
  try {
    db.prepare("UPDATE users SET profile_audience='only_me' WHERE id=?").run(owner.id);
    assert.equal(search(viewer).artists.some(row => row.key === created.artist.key), false);
    assert.equal(search(null).artists.some(row => row.key === created.artist.key), false);
    failure(() => routes["GET /api/artists/:key/profile"](context(viewer, {}, {
      params: { key: encodeURIComponent(created.artist.key) },
    })), 404, "NOT_FOUND");
    const resolved = await routes["GET /api/artists/resolve"](context(viewer, {}, { query: { name: created.artist.name } }));
    assert.equal(resolved.artist, null);
    await assert.rejects(() => routes["POST /api/artists/resolve"](context(viewer, { name: created.artist.name })),
      error => error instanceof ApiError && error.status === 404);
    assert.deepEqual(routes["GET /api/artists/photos"](context(viewer, {}, { query: { name: created.artist.name } })).photos, []);
    assert.equal(search(q.userById.get(owner.id)).artists.some(row => row.key === created.artist.key), true);
    db.prepare("UPDATE users SET profile_audience='everyone' WHERE id=?").run(owner.id);
    db.prepare("INSERT INTO blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)").run(owner.id, viewer.id, Date.now());
    assert.equal(search(viewer).artists.some(row => row.key === created.artist.key), false);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});
