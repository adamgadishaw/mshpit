import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-badges-"));
process.env.PIT_DATA_DIR = dataDir;

const { db, q, badgeStmts, customBadgesFor, publicUser } = await import("./db.js");
const { badgeArt, validateBadge, RESERVED_SLUGS, BADGE_COLORS } = await import("../src/domain/badgeArt.mjs");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

let seq = 0;
function addUser() {
  const id = `u_badge_${++seq}`;
  q.insertUser.run(id, `${id}@example.com`, `User ${seq}`, `bu${seq}`, "hash", "fan", null, null, null, "U", "#123456", Date.now());
  return q.userById.get(id);
}
function addBadge(over = {}) {
  const id = `bdg_${++seq}`;
  badgeStmts.insert.run({
    id, slug: over.slug || `vip-${seq}`, label: over.label || "VIP", description: over.description || "",
    kind: over.kind || "tier", color: over.color || "gold", glyph: over.glyph || "char",
    glyph_char: over.glyph_char ?? "V", created_by: "admin", created_at: Date.now(),
  });
  return badgeStmts.byId.get(id);
}

const valid = { slug: "early-access", label: "Early Access", color: "gold", glyph: "char", glyphChar: "E", kind: "tier" };

test("a valid badge passes validation", () => {
  assert.deepEqual(validateBadge(valid), []);
});

test("a custom badge cannot impersonate a built-in one", () => {
  // The one that matters is `verified`: an admin-made lookalike would quietly
  // devalue the real identity check.
  for (const slug of RESERVED_SLUGS) {
    const problems = validateBadge({ ...valid, slug });
    assert.ok(problems.some((p) => /built-in/.test(p)), `${slug} should be reserved`);
  }
});

test("slugs are constrained so they stay usable as identity", () => {
  for (const slug of ["", "a", "ab", "-leading", "trailing-", "Has Capitals", "has_underscore", "x".repeat(40), "sp ace"]) {
    assert.ok(validateBadge({ ...valid, slug }).length > 0, `${JSON.stringify(slug)} should be rejected`);
  }
  assert.deepEqual(validateBadge({ ...valid, slug: "vip-2026" }), []);
});

test("colour and glyph must come from the palette, never from the caller", () => {
  // This is the injection guard: an arbitrary colour string would otherwise land
  // in an SVG fill attribute.
  assert.ok(validateBadge({ ...valid, color: "#ff0000" }).length > 0);
  assert.ok(validateBadge({ ...valid, color: "red; </svg>" }).length > 0);
  assert.ok(validateBadge({ ...valid, glyph: "onload" }).length > 0);
  assert.ok(validateBadge({ ...valid, kind: "superuser" }).length > 0);
});

test("badgeArt only ever returns palette values, whatever it is handed", () => {
  const hostile = badgeArt({ color: "javascript:alert(1)", glyph: "<script>", glyphChar: "AAAA" });
  assert.equal(hostile.fill, BADGE_COLORS.cool.fill, "an unknown colour falls back to the palette");
  assert.equal(hostile.glyph, "check", "an unknown glyph falls back");
  assert.equal(hostile.char, null);
  // A char glyph is clamped to exactly one character so it cannot overflow the seal.
  assert.equal(badgeArt({ color: "gold", glyph: "char", glyphChar: "vip" }).char, "V");
});

test("granting is idempotent and revoking is clean", () => {
  const user = addUser();
  const badge = addBadge({ slug: `crowd-${seq}` });
  const at = Date.now();
  badgeStmts.grant.run(user.id, badge.id, "admin", at, "");
  badgeStmts.grant.run(user.id, badge.id, "admin", at, "");
  assert.equal(customBadgesFor(user.id).length, 1, "granting twice must not duplicate");

  badgeStmts.revoke.run(user.id, badge.id);
  assert.equal(customBadgesFor(user.id).length, 0);
});

test("a retired badge stays visible to the people who already hold it", () => {
  const user = addUser();
  const badge = addBadge({ slug: `tour-${seq}` });
  badgeStmts.grant.run(user.id, badge.id, "admin", Date.now(), "");
  badgeStmts.setArchived.run(Date.now(), Date.now(), badge.id);

  assert.equal(customBadgesFor(user.id).length, 1, "retiring must not strip it from holders");
  assert.ok(!badgeStmts.active.all().some((b) => b.id === badge.id), "but it leaves the grantable list");
});

test("badges are opt-in on publicUser, because feeds render it per row", () => {
  const user = addUser();
  const badge = addBadge({ slug: `vipx-${seq}`, label: "VIP" });
  badgeStmts.grant.run(user.id, badge.id, "admin", Date.now(), "");
  const fresh = q.userById.get(user.id);

  assert.equal(publicUser(fresh).badges, undefined, "the default must not query per row");
  const withBadges = publicUser(fresh, { badges: true });
  assert.equal(withBadges.badges.length, 1);
  assert.equal(withBadges.badges[0].label, "VIP");
});

test("a custom badge never grants the built-in verified check", () => {
  const user = addUser();
  const badge = addBadge({ slug: `looks-legit-${seq}`, label: "Verified-ish" });
  badgeStmts.grant.run(user.id, badge.id, "admin", Date.now(), "");
  const view = publicUser(q.userById.get(user.id), { badges: true });
  assert.equal(view.verified, false, "custom badges are separate from the identity check");
});
