import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { displayedProfileBadges } from "../src/domain/profileBadges.mjs";

const dataDir = mkdtempSync(join(tmpdir(), "pit-profile-badge-selection-"));
process.env.PIT_DATA_DIR = dataDir;
process.env.PIT_ALLOW_EMPTY_DB_BOOTSTRAP = "true";
delete process.env.RESEND_API_KEY;
delete process.env.MAIL_FROM;
const { db, q, publicUser, badgeStmts, customBadgesFor } = await import("./db.js");
const { ApiError, routes } = await import("./api.js");
after(() => { db.close(); rmSync(dataDir, { recursive: true, force: true }); });
let sequence = 0;
function addUser() {
  const id = `profile_badges_${++sequence}`;
  q.insertUser.run(id, `${id}@example.test`, "Profile Fan", id, "test-hash", "fan", null, null, null, "PF", "#123456", Date.now());
  db.prepare("UPDATE users SET age_band='18_plus', email_verified_at=?, verified=1 WHERE id=?").run(Date.now(), id);
  return q.userById.get(id);
}
const patch = (user, extras) => routes["PATCH /api/me"]({ user: q.userById.get(user.id), ip: `badge-${++sequence}`, body: { extras } });
const profile = (owner, viewer = null) => routes["GET /api/users/:id"]({ user: viewer, params: { id: owner.id } });

test("selection persists through save, fresh self read and other-user public projections", () => {
  const owner = addUser(), viewer = addUser();
  assert.equal(publicUser(owner, { self: true }).profileBadgeSelectionSupported, true);
  assert.equal(publicUser(owner, { self: true }).profileBadges, null);
  for (const selection of [["verified"], [], null]) {
    const saved = patch(owner, { profileBadges: selection, pronouns: "they/them" }).user;
    assert.deepEqual(saved.profileBadges, selection);
    assert.deepEqual(JSON.parse(q.userById.get(owner.id).extras).profileBadges, selection);
    const fresh = routes["GET /api/me"]({ user: q.userById.get(owner.id) }).user;
    assert.deepEqual(fresh.profileBadges, selection);
    assert.equal(fresh.profileBadgeSelectionSupported, true);
    for (const user of [profile(owner).user, profile(owner, viewer).user]) {
      assert.deepEqual(user.profileBadges, selection);
      assert.equal(user.pronouns, "they/them");
      assert.equal(Object.hasOwn(user, "profileBadgeSelectionSupported"), false);
      assert.equal(Object.hasOwn(user, "email"), false);
    }
    assert.deepEqual(patch(owner, { accent: "blue" }).user.profileBadges, selection, "unrelated saves retain selection");
  }
});

test("malformed/unknown selections fail atomically and preference cannot forge account status", () => {
  const owner = addUser();
  patch(owner, { profileBadges: [] });
  for (const value of [["invented"], ["verified", "verified"], ["__proto__"], "verified", {}, false]) {
    assert.throws(() => patch(owner, { profileBadges: value, pronouns: "new" }), error => error instanceof ApiError && error.status === 400);
    assert.deepEqual(publicUser(q.userById.get(owner.id), { self: true }).profileBadges, []);
    assert.equal(publicUser(q.userById.get(owner.id), { self: true }).pronouns, undefined);
  }
  // IDs are only a cosmetic filter. Even a handcrafted choice cannot award a
  // status or change permissions; consumers always intersect actual eligibility.
  const chosen = patch(owner, { profileBadges: ["staff", "verified"] }).user;
  assert.equal(chosen.role, "fan");
  assert.equal(chosen.verified, true);
  assert.deepEqual(displayedProfileBadges(["verified"], chosen.profileBadges), ["verified"]);
  db.prepare("UPDATE users SET verified=0 WHERE id=?").run(owner.id);
  const revoked = profile(owner).user;
  assert.equal(revoked.verified, false);
  assert.deepEqual(displayedProfileBadges([], revoked.profileBadges), []);
});

test("profile audience and blocking continue to protect badge selections", () => {
  const owner = addUser(), viewer = addUser();
  patch(owner, { profileBadges: [] });
  db.prepare("UPDATE users SET profile_audience='only_me' WHERE id=?").run(owner.id);
  for (const person of [null, viewer]) assert.throws(() => profile(owner, person), error => error.status === 404);
  assert.deepEqual(profile(owner, q.userById.get(owner.id)).user.profileBadges, []);
  db.prepare("UPDATE users SET profile_audience='everyone' WHERE id=?").run(owner.id);
  db.prepare("INSERT INTO blocks (blocker_id,blocked_id,created_at) VALUES (?,?,?)").run(owner.id, viewer.id, Date.now());
  assert.throws(() => profile(owner, viewer), error => error.status === 404);
});

test("hide-all preserves custom awards, membership milestones, sponsor and staff authority", () => {
  const owner = addUser();
  db.prepare("UPDATE users SET role='admin', sponsor=1 WHERE id=?").run(owner.id);
  const badgeId = 'badge-preserved-custom';
  badgeStmts.insert.run({ id: badgeId, slug: 'fixture-award', label: 'Fixture award', description: '', kind: 'tier', color: 'gold', glyph: 'char', glyph_char: 'F', created_by: owner.id, created_at: Date.now() });
  badgeStmts.grant.run(owner.id, badgeId, owner.id, Date.now(), 'fixture');
  const before = publicUser(q.userById.get(owner.id), { self: true, badges: true });
  const awarded = customBadgesFor(owner.id);
  patch(owner, { profileBadges: [] });
  const after = publicUser(q.userById.get(owner.id), { self: true, badges: true });
  for (const key of ['role', 'verified', 'sponsor', 'membershipBadge', 'emailVerified', 'badges']) {
    assert.deepEqual(after[key], before[key], key + ' must remain authoritative');
  }
  assert.deepEqual(customBadgesFor(owner.id), awarded);
  assert.deepEqual(after.profileBadges, []);
});
