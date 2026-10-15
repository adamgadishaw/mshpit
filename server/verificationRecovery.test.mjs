import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LEGAL_ACCEPTANCE_VERSION } from '../src/domain/privacyDisclosures.mjs';
const directory = mkdtempSync(join(tmpdir(), 'pit-recovery-'));
process.env.PIT_DATA_DIR = directory;
process.env.PIT_ALLOW_EMPTY_DB_BOOTSTRAP = 'true';
process.env.NODE_ENV = 'test';
process.env.RESEND_API_KEY = 'synthetic-mocked-key';
process.env.MAIL_FROM = 'Fixture <sender@example.test>';
process.env.EMAIL_ALLOWED_RECIPIENTS = 'recovery@example.test';
delete process.env.EMAIL_VERIFICATION_ENABLED;
const originalFetch = globalThis.fetch;
let messages = [], delivery = async () => ({ ok: true, json: async () => ({}) });
globalThis.fetch = async (url, options) => {
  assert.equal(url, 'https://api.resend.com/emails', 'no unmocked network access');
  messages.push(JSON.parse(options.body));
  return delivery();
};
const { db, q } = await import('./db.js');
const { routes } = await import('./api.js');
const { createSession } = await import('./auth.js');
const { readAuthorizedRequest } = await import('./requestAuthorization.js');
const { allowedUnsafeRequestOrigins, assertUnsafeRequestOrigin } = await import('./requestSecurity.js');
const { mintVerifyToken, completeVerification } = await import('./verification.js');
const { assertAccountMutationAccess: gate } = await import('./accountMutationAccess.js');
after(async () => { await new Promise(r => setImmediate(r)); globalThis.fetch = originalFetch; db.close(); rmSync(directory, { recursive: true, force: true }); });
let seq = 0;
function user(role = 'fan') { const id = `recovery_${++seq}`; q.insertUser.run(id, `${id}@example.test`, id, id, 'hash', role, null, null, null, 'R', '#123456', Date.now()); return q.userById.get(id); }
const context = (u, body = {}, id = null) => ({ user: u, body, params: { id }, ip: `recovery-${++seq}`, requestId: `request-${seq}`, setHeader() {} });
const manual = (actor, target, overrides = {}) => routes['POST /api/admin/users/:id/verify-email'](context(actor, { reason: 'Email route unavailable; synthetic support review', confirmedTargetId: target.id, confirmedHandle: target.handle, ...overrides }, target.id));
const verify = (token, u) => routes['POST /api/verify-email'](context(u, { token }));
const resend = u => routes['POST /api/verify-email/resend'](context(u));
const tokenIn = m => decodeURIComponent(m.text.match(/#verify=([A-Za-z0-9_-]+)/)[1]);

test('signup → resend → old link rejected → newest succeeds → stale-session follow/feed gate reload', async () => {
  messages = [];
  const signup = await routes['POST /api/signup']({ ...context(null), ua: 'synthetic-test', setSession() {}, body: {
    name: 'Recovery Fixture', email: 'recovery@example.test', password: 'Local-test-password1', handle: 'recoveryfixture',
    genres: ['Rock'], ageBand: '18_plus', termsVersion: LEGAL_ACCEPTANCE_VERSION,
  } });
  await new Promise(r => setImmediate(r));
  const stale = q.userById.get(signup.user.id);
  const original = tokenIn(messages[0]);
  const session = createSession(stale.id);
  const followee = user();
  const authorization = (method, pathname, body = {}) => readAuthorizedRequest({ token: session.token, expectedAccount: stale.id, method, pathname, readBody: async () => body });
  await assert.rejects(authorization("POST", `/api/users/${followee.id}/follow`), e => e.code === "EMAIL_VERIFICATION_REQUIRED");
  for (const path of ['/api/users/other/follow', '/api/feed/impressions']) {
    assert.throws(() => gate({ method: 'POST', pathname: path, user: stale }), e => e.code === 'EMAIL_VERIFICATION_REQUIRED');
  }
  const sent = await resend(stale);
  assert.equal(sent.deliveryStatus, 'provider-accepted');
  const newest = tokenIn(messages.at(-1));
  assert.notEqual(original, newest);
  assert.equal(verify(original, stale).reason, 'invalid-expired-or-replaced');
  assert.equal(q.userById.get(stale.id).email_verified_at, 0);
  assert.equal(verify(newest, stale).user.emailVerified, true);
  assert.equal(verify(newest, stale).alreadyVerified, true, 'lost response and another tab may replay');
  const authorized = await authorization('POST', `/api/users/${followee.id}/follow`, { following: true });
  assert.equal(routes['POST /api/users/:id/follow']({ ...context(authorized.user, authorized.body, followee.id), ...authorized }).following, true);
  const reader = await authorization('GET', '/api/feed');
  assert.ok(Array.isArray(routes['GET /api/feed']({ ...context(reader.user), query: {}, ...reader }).posts));
  const refreshed = await resend(stale);
  assert.equal(refreshed.verified, true, 'cross-tab recovery refreshes DB state');
  assert.equal(refreshed.user.id, stale.id);
  for (const path of ['/api/users/other/follow', '/api/feed/impressions']) {
    assert.equal(gate({ method: 'POST', pathname: path, user: q.userById.get(stale.id) }), true);
  }
});

test('resend stays pending until provider acceptance; rejection is never sent', async () => {
  const target = user();
  db.prepare('UPDATE users SET email=? WHERE id=?').run('recovery@example.test', target.id);
  let release;
  delivery = () => new Promise(r => { release = r; });
  let resolved = false;
  const pending = resend(q.userById.get(target.id)).then(r => { resolved = true; return r; });
  await new Promise(r => setImmediate(r));
  assert.equal(resolved, false);
  release({ ok: true, json: async () => ({}) });
  assert.equal((await pending).sent, true);
  delivery = async () => ({ ok: false, status: 503 });
  const failed = await resend(q.userById.get(target.id));
  assert.equal(failed.sent, false);
  assert.equal(failed.deliveryStatus, 'failed');
  assert.equal(q.userById.get(target.id).email_verified_at, 0);
});

test('different-account success never adopts another account; invalid tokens cannot identify owners', () => {
  const a = user(), b = user();
  const token = mintVerifyToken(a.id);
  const result = verify(token, b);
  assert.equal(result.verified, true);
  assert.equal(result.user, undefined);
  assert.equal(q.userById.get(b.id).email_verified_at, 0);
  assert.deepEqual(verify('invalid', b), { ok: true, verified: false, reason: 'invalid-expired-or-replaced' });
});

test('manual verification rejects guests, fans, moderators, missing reason and wrong/stale targets', () => {
  const target = user(), admin = user('admin');
  for (const actor of [null, user(), user('moderator')]) assert.throws(() => manual(actor, target), e => [401,403].includes(e.status));
  assert.throws(() => manual(admin, target, { reason: '' }), e => e.status === 400);
  assert.throws(() => manual(admin, target, { confirmedTargetId: 'other' }), e => e.code === 'CONFLICT');
  assert.throws(() => manual(admin, target, { confirmedHandle: 'different' }), e => e.code === 'CONFLICT');
  assert.equal(q.userById.get(target.id).email_verified_at, 0);
});

test('manual verification is idempotent under concurrent requests, audited, clears tokens and preserves restrictions', async () => {
  const admin = user('admin'), target = user();
  const old = mintVerifyToken(target.id);
  db.prepare('UPDATE users SET is_banned=1, dormant_at=123, suspended_until=? WHERE id=?').run(Date.now()+60000, target.id);
  const beforeMessages = messages.length;
  const results = await Promise.all([Promise.resolve().then(() => manual(admin, target)), Promise.resolve().then(() => manual(admin, target))]);
  assert.deepEqual(results.map(r => r.result), ['verified', 'already-verified']);
  const fresh = q.userById.get(target.id);
  assert.equal(fresh.email_verification_method, 'admin-manual');
  const directory = routes['GET /api/admin/members']({ ...context(admin), query: { q: target.id } });
  assert.equal(directory.users.find(u => u.id === target.id).emailVerificationMethod, 'admin-manual');
  assert.equal(fresh.is_banned, 1); assert.equal(fresh.dormant_at, 123); assert.equal(fresh.role, 'fan'); assert.equal(fresh.verified, 0);
  assert.equal(completeVerification(old), null);
  assert.equal(messages.length, beforeMessages, 'manual verification must not send mail');
  const audit = db.prepare("SELECT * FROM moderation_actions WHERE target_id=? AND action='verify-email' ORDER BY rowid").all(target.id);
  assert.equal(audit.length, 2);
  assert.equal(audit[0].actor_id, admin.id); assert.ok(audit[0].created_at); assert.ok(audit[0].reason);
  assert.equal(JSON.parse(audit[0].next_state).emailDeliveryProven, false);
  assert.equal(JSON.parse(audit[1].next_state).result, 'already-verified');
});

test('audit failure rolls back token invalidation, provenance and verification', () => {
  const admin = user('admin'), target = user(); const old = mintVerifyToken(target.id);
  db.exec("CREATE TEMP TRIGGER fail_manual_audit BEFORE INSERT ON moderation_actions WHEN NEW.action='verify-email' BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END");
  try { assert.throws(() => manual(admin,target), /synthetic audit failure/); }
  finally { db.exec('DROP TRIGGER fail_manual_audit'); }
  const fresh = q.userById.get(target.id);
  assert.equal(fresh.email_verified_at, 0); assert.equal(fresh.email_verification_method, null); assert.ok(fresh.email_verify_hash);
  const failure = db.prepare("SELECT next_state FROM moderation_actions WHERE target_id=? AND action='verify-email-failed'").get(target.id);
  assert.equal(JSON.parse(failure.next_state).result, 'failed');
  assert.equal(completeVerification(old).user.id, target.id);
});

test('browser CSRF protection rejects foreign-origin manual verification before dispatch', () => {
  const origins = allowedUnsafeRequestOrigins({ production: true, publicOrigin: 'https://www.mshpit.com' });
  assert.throws(() => assertUnsafeRequestOrigin('POST', { origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' }, origins), e => e.status === 403);
  assert.doesNotThrow(() => assertUnsafeRequestOrigin('POST', { origin: 'https://www.mshpit.com', 'sec-fetch-site': 'same-origin' }, origins));
  const unverifiedAdmin = user('admin');
  assert.throws(() => gate({ method: 'POST', pathname: '/api/admin/users/target/verify-email', user: unverifiedAdmin }), e => e.code === 'EMAIL_VERIFICATION_REQUIRED');
});
