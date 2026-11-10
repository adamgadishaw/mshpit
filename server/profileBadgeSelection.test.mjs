import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
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

test("fresh public projection feeds the actual shared profile name badge element", async () => {
  const require = createRequire(import.meta.url);
  const { parse } = require('@babel/parser');
  const { transformSync } = require('@babel/core');
  const source = readFileSync(new URL('../src/screens/ProfileScreen.jsx', import.meta.url), 'utf8');
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
  const rows = [];
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    if (value.type === 'JSXElement' && value.openingElement.name.name === 'BadgeRow') rows.push(value);
    for (const child of Object.values(value)) if (Array.isArray(child)) child.forEach(walk); else if (child && typeof child === 'object') walk(child);
  }
  walk(ast);
  assert.equal(rows.length, 1);
  const jsx = source.slice(rows[0].start, rows[0].end);
  const code = transformSync('module.exports = (user, userBadges) => (' + jsx + ');', { babelrc: false, configFile: false, plugins: [[require('@babel/plugin-transform-react-jsx'), { runtime: 'automatic' }], require('@babel/plugin-transform-modules-commonjs')] }).code;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'BadgeRow', 'displayedProfileBadges', code)(require, module, module.exports, 'BadgeRow', displayedProfileBadges);
  const render = module.exports;
  const owner = addUser();
  for (const selection of [null, [], ['verified'], ['staff']]) {
    patch(owner, { profileBadges: selection });
    for (const user of [routes['GET /api/me']({ user: q.userById.get(owner.id) }).user, profile(owner).user]) {
      const element = render(user, u => u.verified ? ['verified'] : []);
      assert.equal(element.type, 'BadgeRow');
      assert.deepEqual(element.props.badges, selection === null || selection.includes('verified') ? ['verified'] : []);
    }
  }
  patch(owner, { profileBadges: ['verified'] });
  db.prepare('UPDATE users SET verified=0 WHERE id=?').run(owner.id);
  assert.deepEqual(render(profile(owner).user, u => u.verified ? ['verified'] : []).props.badges, []);
});

test("unchanged website Store edits retain preferences through the real API and public cache", async () => {
  const require = createRequire(import.meta.url);
  const { parse } = require('@babel/parser');
  const { captureAccountMutation, accountMutationIsCurrent } = await import('../src/domain/accountMutation.mjs');
  const { publicProfileCacheEntry } = await import('../src/domain/dataPolicy.mjs');
  const { profileGenreSelection } = await import('../src/domain/genrePreferences.mjs');
  const { clean, cleanName, cleanHandle, isHandle, LIMITS } = await import('../src/domain/validation.mjs');
  const source = readFileSync(new URL('../src/store.js', import.meta.url), 'utf8');
  const provider = parse(source, { sourceType: 'module', plugins: ['jsx'] }).program.body.find(n => n.declaration?.id?.name === 'StoreProvider').declaration;
  const declarations = provider.body.body.flatMap(n => n.type === 'VariableDeclaration' ? n.declarations : []);
  const callback = declarations.find(n => n.id?.name === 'updateProfile').init;
  const guards = declarations.filter(n => ['renderedAccountMutation', 'currentMutationActor'].includes(n.id?.name)).map(n => `const ${source.slice(n.start, n.end)};`).join('\n');
  for (const selection of [[], ['verified'], null]) {
    const owner = addUser();
    patch(owner, { profileBadges: selection });
    const initial = routes['GET /api/me']({ user: q.userById.get(owner.id) }).user;
    const sessionRef = { current: initial }, accountMutationEpochRef = { current: 1 };
    const state = { session: initial, users: [publicProfileCacheEntry(initial)] }, calls = [];
    const dependencies = { session: initial, authReadyRef: { current: true }, sessionRef, accountMutationEpochRef,
      captureAccountMutation, accountMutationIsCurrent, publicProfileCacheEntry, profileGenreSelection,
      clean, cleanName, cleanHandle, isHandle, LIMITS, ENABLE_DEMO_DATA: false,
      api: async (path, options) => {
        calls.push({ path, options });
        assert.equal(path, '/api/me');
        return routes['PATCH /api/me']({ user: q.userById.get(owner.id), body: options.body, ip: 'unchanged-store-fixture' });
      },
      setUsers: update => { state.users = update(state.users); },
      setSession: update => { state.session = update(state.session); },
    };
    const save = new Function(...Object.keys(dependencies), `${guards}\nreturn (${source.slice(callback.start, callback.end)});`)(...Object.values(dependencies));
    const result = await save({ pronouns: 'they/them', accent: 'blue' }, { expectedAccountId: owner.id });
    assert.equal(result.ok, true);
    assert.deepEqual(calls[0].options.body, { extras: { pronouns: 'they/them', accent: 'blue' } });
    assert.deepEqual(JSON.parse(q.userById.get(owner.id).extras).profileBadges, selection);
    assert.deepEqual(profile(owner).user.profileBadges, selection);
    assert.deepEqual(state.users[0].profileBadges, selection);
    assert.deepEqual(state.session.profileBadges, selection);
    assert.equal(Object.hasOwn(state.users[0], 'profileBadgeSelectionSupported'), false);
    assert.equal(state.session.pronouns, 'they/them');
  }
});
