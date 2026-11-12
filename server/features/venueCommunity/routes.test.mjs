import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { venueCommunityRoutes } from './routes.js';
import { ownsVerifiedVenue } from './ownership.js';
import { ApiError } from '../../errors.js';
import { clean } from '../../validate.js';
import { assertSafeAuthoredText } from '../../contentSafety.js';
import { creatorPostRoutes } from '../creatorPosts/creatorPostRoutes.js';
import { canonicalVenueCreatorTarget } from './creatorTarget.js';
import { assertCreatorUpdate, managedCreatorEntity } from '../creatorPosts/creatorPostService.js';

const dir = mkdtempSync(join(tmpdir(), 'pit-venue-community-'));
process.env.PIT_DATA_DIR = dir;
const { db, q } = await import('../../db.js');
await import('../../auth.js');
after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
let seq = 0;
const now = () => 1800000000000 + seq++;
const venue = '/venue/ticketmaster-room-a', otherVenue = '/venue/ticketmaster-room-b';
const snapshots = new Map([venue, otherVenue, '/venue/legacy-room'].map(path => [path, { path, venue: { name: 'Same Room', place: 'Toronto, Ontario, Canada', source: path.includes('ticketmaster') ? 'ticketmaster' : null, providerVenueId: path.includes('ticketmaster') ? path : null } }]));
const audit = [];
let auditFailure = false;
function user(role = 'fan') {
  const id = `vct_${seq++}`;
  q.insertUser.run(id, `${id}@example.test`, id, id, 'hash', role, 'Toronto', 43, -79, 'VC', '#111111', now());
  db.prepare('UPDATE users SET email_verified_at=? WHERE id=?').run(now(), id);
  return q.userById.get(id);
}
const requireUser = ctx => { if (!ctx.user) throw new ApiError(401, 'Sign in', 'AUTH_REQUIRED'); return ctx.user; };
const routes = venueCommunityRoutes({ db, readSnapshot: path => snapshots.get(path), requireUser,
  requireAdmin: ctx => { const actor = requireUser(ctx); if (actor.role !== 'admin') throw new ApiError(403, 'Forbidden', 'FORBIDDEN'); return actor; },
  limit() {}, uid: prefix => `${prefix}_${seq++}`, now, clean, assertSafeAuthoredText,
  moderationRecord: (...args) => { if (auditFailure) throw new Error('Audit unavailable'); audit.push(args); }, atomicWrite: work => { db.exec('BEGIN IMMEDIATE'); try { const result = work(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } },
});
const run = (route, actor, body = {}, extra = {}) => routes[route]({ user: actor, body, params: {}, query: {}, ...extra });
const read = (actor, path = venue, after = null) => run('GET /api/venue-community', actor, {}, { query: { path, after } });
const rate = (actor, rating = 4, path = venue, extra = {}) => run('PUT /api/venue-community/rating', actor, { path, rating, text: 'Good sound and sightlines', ...extra });
const claim = (actor, path = venue) => run('POST /api/venue-community/claims', actor, { path, accountConversionAcknowledged: true, website: 'https://venue.example.test', note: 'I manage this venue and staff can contact our official office.' });
const review = (staff, id, decision = 'approved', extra = {}) => run('POST /api/admin/venue-claims/:id/review', staff, { decision, note: 'Contacted the official office independently and checked authority.', method: 'official_contact', reference: 'https://venue.example.test/contact', authorityConfirmed: true, officialEvidenceConfirmed: true, conversionConfirmed: true, revocationConfirmed: true, expectedOwnerId: decision === 'revoked' ? db.prepare('SELECT user_id FROM venue_claims WHERE id=?').get(id)?.user_id : null, ...extra }, { params: { id } });

test('guests see an honest empty community page and cannot rate, claim or review', () => {
  const result = read(null);
  assert.equal(result.ownership, 'community'); assert.equal(result.rating.count, 0); assert.equal(result.rating.average, null);
  assert.equal(result.claim, null); assert.equal(result.myReview, null);
  for (const fn of [() => rate(null), () => claim(null), () => review(null, 'missing')]) assert.throws(fn, { status: 401 });
});
test('rating validation rejects coercions, nonfinite values and unsupported fractions', () => {
  const actor = user();
  for (const value of ['4', null, 0, 5.5, -1, NaN, Infinity, 3.2]) assert.throws(() => rate(actor, value), { status: 400 });
  assert.equal(rate(actor, 3.5).myReview.rating, 3.5);
});
test('repeated saves update one stable review; canonical venue identities stay separate', () => {
  const actor = user(); const first = rate(actor).myReview;
  const second = rate(actor, 5).myReview;
  assert.equal(second.id, first.id);
  assert.equal(db.prepare('SELECT count(*) n FROM venue_reviews WHERE user_id=? AND venue_key=?').get(actor.id, venue).n, 1);
  rate(actor, 2, otherVenue);
  assert.equal(read(actor, otherVenue).myReview.rating, 2); assert.equal(read(actor).myReview.rating, 5);
  assert.equal(ownsVerifiedVenue(db, actor.id, venue), false);
});
test('private, blocked, banned, reported and removed reviews do not affect visible counts', () => {
  const viewer = user(), privateUser = user(), blocked = user(), banned = user(), reported = user(), removed = user();
  for (const actor of [privateUser, blocked, banned, reported, removed]) rate(actor);
  db.prepare("UPDATE users SET profile_audience='only_me' WHERE id=?").run(privateUser.id);
  db.prepare('INSERT INTO blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)').run(blocked.id, viewer.id, now());
  db.prepare('UPDATE users SET is_banned=1 WHERE id=?').run(banned.id);
  const reportId = read(reported).myReview.id;
  db.prepare("INSERT INTO reports(id,target_type,target_id,reason,reporter_id,status,created_at) VALUES(?,'venue_review',?,'test',?,'open',?)").run(`report_${seq++}`, reportId, viewer.id, now());
  db.prepare('UPDATE venue_reviews SET removed=1 WHERE user_id=?').run(removed.id);
  const result = read(viewer);
  for (const actor of [privateUser, blocked, banned, reported, removed]) assert.ok(!result.reviews.some(r => r.userId === actor.id));
  assert.throws(() => rate(reported), { status: 409 });
  assert.throws(() => rate(banned), { status: 403 });
  assert.ok(read(privateUser).reviews.some(r => r.userId === privateUser.id));
});
test('review pagination uses stable cursor, full aggregates and scope binding', () => {
  for (let i = 0; i < 25; i++) rate(user(), 4, otherVenue);
  const first = read(null, otherVenue); assert.equal(first.reviews.length, 20); assert.equal(first.rating.count, 26);
  const second = read(null, otherVenue, first.nextCursor); assert.equal(second.reviews.length, 6); assert.equal(second.rating.count, 26);
  assert.equal(new Set([...first.reviews, ...second.reviews].map(r => r.id)).size, 26);
  assert.throws(() => read(null, venue, first.nextCursor), { status: 400 });
});
test('member deletion is scoped to their review and repeatable', () => {
  const actor = user(), another = user(); rate(actor); rate(another);
  for (let i = 0; i < 2; i++) run('DELETE /api/venue-community/rating', actor, { path: venue, userId: another.id });
  assert.equal(read(actor).myReview, null); assert.ok(read(another).myReview);
});
test('claims require verified email, canonical identity, evidence and a current session', () => {
  const actor = user(); db.prepare('UPDATE users SET email_verified_at=0 WHERE id=?').run(actor.id);
  assert.throws(() => claim(actor), { status: 403 }); db.prepare('UPDATE users SET email_verified_at=? WHERE id=?').run(now(), actor.id);
  assert.throws(() => claim(actor, '/venue/legacy-room'), { status: 400 });
  assert.throws(() => run('POST /api/venue-community/claims', actor, { path: venue, website: 'javascript:alert(1)', note: 'A long enough explanation for testing' }), { status: 400 });
  assert.throws(() => run('POST /api/venue-community/claims', actor, { path: venue, accountConversionAcknowledged: true, website: 'https://venue.example.test', note: 'A long enough explanation for testing' }, { assertCurrentSession() { throw new ApiError(401, 'Expired', 'AUTH_REQUIRED'); } }), { status: 401 });
  assert.equal(read(actor).claim, null);
});
test('pending claims are idempotent, private and never confer ownership or account role', () => {
  const actor = user(); const first = claim(actor); const second = claim(actor);
  assert.equal(first.claim.id, second.claim.id); assert.equal(second.claim.status, 'pending');
  assert.equal(second.isOperator, false); assert.equal(second.ownership, 'community');
  assert.equal(ownsVerifiedVenue(db, actor.id, venue), false); assert.equal(q.userById.get(actor.id).role, 'fan');
  assert.equal(read(user()).claim, null); assert.equal(JSON.stringify(read(null)).includes('official office'), false);
  assert.throws(() => review(actor, first.claim.id), { status: 403 });
  run('DELETE /api/venue-community/claims/:id', user(), {}, { params: { id: first.claim.id } }); assert.equal(read(actor).claim.status, 'pending');
  run('DELETE /api/venue-community/claims/:id', actor, {}, { params: { id: first.claim.id } }); assert.equal(read(actor).claim.status, 'cancelled');
});
test('staff cannot self-approve or grant authority without independent evidence', () => {
  const staff = user(), actor = user(); const self = claim(staff).claim;
  db.prepare("UPDATE users SET role='admin' WHERE id=?").run(staff.id); staff.role = 'admin';
  const pending = claim(actor).claim;
  assert.throws(() => review(staff, self.id), { status: 403 });
  for (const extra of [{ authorityConfirmed: false }, { officialEvidenceConfirmed: false }, { conversionConfirmed: false }, { expectedOwnerId: 'forged' }, { method: 'self_assertion' }, { reference: 'http://venue.example.test' }, { note: 'okay' }]) assert.throws(() => review(staff, pending.id, 'approved', extra), { status: 400 });
  assert.equal(ownsVerifiedVenue(db, actor.id, venue), false);
});
test('approval is exclusive, replay-safe, audited, reversible and uses the shared creator registry', () => {
  const staff = user('admin'), actor = user('venue'), competitor = user('venue');
  const pending = claim(actor).claim, competing = claim(competitor).claim;
  review(staff, pending.id); review(staff, pending.id);
  assert.equal(read(actor).ownership, 'verified'); assert.equal(read(actor).isOperator, true);
  assert.equal(ownsVerifiedVenue(db, actor.id, venue), true); assert.equal(q.userById.get(actor.id).role, 'venue');
  assert.equal(db.prepare("SELECT owner_id FROM creator_entities WHERE entity_type='venue' AND entity_key=?").get(venue).owner_id, actor.id);
  assert.throws(() => review(staff, competing.id), { status: 409 });
  assert.throws(() => claim(user()), { status: 409 });
  assert.equal(audit.filter(row => row[3] === pending.id && row[1] === 'venue_claim_approved').length, 1);
  db.prepare('UPDATE users SET is_banned=1 WHERE id=?').run(actor.id); assert.equal(ownsVerifiedVenue(db, actor.id, venue), false);
  db.prepare('UPDATE users SET is_banned=0 WHERE id=?').run(actor.id);
  review(staff, pending.id, 'revoked'); assert.equal(ownsVerifiedVenue(db, actor.id, venue), false);
  assert.equal(db.prepare("SELECT owner_id FROM creator_entities WHERE entity_type='venue' AND entity_key=?").get(venue).owner_id, null);
  assert.equal(read(actor).claim.status, 'revoked'); assert.equal(read(null).ownership, 'community');
  assert.throws(() => review(staff, pending.id), { status: 409 });
});
test('withdrawn and rejected claims cannot be approved; queue is admin-only and paginated', () => {
  const staff = user('admin'), actor = user(); const pending = claim(actor).claim;
  review(staff, pending.id, 'rejected'); assert.throws(() => review(staff, pending.id), { status: 409 });
  assert.throws(() => run('GET /api/admin/venue-claims', actor), { status: 403 });
  const result = run('GET /api/admin/venue-claims', staff);
  assert.ok(result.claims.every(row => row.status === 'pending')); assert.ok(result.claims.length <= 20);
});
test('account erasure removes claims and clears the shared creator ownership', () => {
  const actor = user('venue'), staff = user('admin'); const pending = claim(actor).claim; review(staff, pending.id);
  db.prepare('DELETE FROM users WHERE id=?').run(actor.id);
  assert.equal(db.prepare('SELECT 1 FROM venue_claims WHERE id=?').get(pending.id), undefined);
  assert.equal(ownsVerifiedVenue(db, actor.id, venue), false);
  assert.equal(db.prepare("SELECT owner_id FROM creator_entities WHERE entity_type='venue' AND entity_key=?").get(venue).owner_id, null);
  assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='venue_operators'").get(), undefined);
});

test('artist, event and staff accounts cannot request or silently acquire venue classification', () => {
  const staff = user('admin');
  for (const role of ['artist', 'event', 'admin', 'mod']) {
    const actor = user(), pending = claim(actor).claim;
    db.prepare('UPDATE users SET role=? WHERE id=?').run(role, actor.id);
    assert.throws(() => claim(actor), { status: 403 });
    assert.throws(() => review(staff, pending.id, 'approved', { role: 'venue' }), { status: 403 });
    assert.equal(read(actor).claim.status, 'pending'); assert.equal(read(actor).isOperator, false);
    assert.equal(q.userById.get(actor.id).role, role);
    assert.equal(db.prepare("SELECT owner_id FROM creator_entities WHERE entity_type='venue' AND entity_key=?").get(venue).owner_id, null);
  }
});

test('held creator pages cannot be reactivated by approval and revocation preserves moderation status', () => {
  const path = '/venue/ticketmaster-room-shared';
  snapshots.set(path, { path, venue: { name: 'Shared Room', place: 'Toronto, Ontario, Canada', source: 'ticketmaster', providerVenueId: 'room-shared' } });
  const staff = user('admin'), actor = user('venue'), pending = claim(actor, path).claim;
  db.prepare("INSERT INTO creator_entities(entity_type,entity_key,name,status) VALUES('venue',?,'Shared Room','held')").run(path);
  assert.throws(() => review(staff, pending.id), { status: 409 });
  assert.equal(read(actor, path).claim.status, 'pending');
  db.prepare("UPDATE creator_entities SET status='active' WHERE entity_key=?").run(path);
  review(staff, pending.id);
  db.prepare("UPDATE creator_entities SET status='held' WHERE entity_key=?").run(path);
  assert.equal(ownsVerifiedVenue(db, actor.id, path), false);
  review(staff, pending.id, 'revoked');
  const registered = db.prepare("SELECT owner_id,status FROM creator_entities WHERE entity_type='venue' AND entity_key=?").get(path);
  assert.equal(registered.owner_id, null); assert.equal(registered.status, 'held');
});
test('cover requests are bounded, read-only, no-store and omit unknown venue images', () => {
  const headers = {};
  const result = run('GET /api/venue-community/covers', null, {}, { query: { paths: '/venue/missing' }, setHeader(key, value) { headers[key] = value; } });
  assert.deepEqual(result, { covers: [{ path: '/venue/missing', photo: null }] }); assert.equal(headers['Cache-Control'], 'no-store');
  assert.throws(() => run('GET /api/venue-community/covers', null, {}, { query: { paths: Array(13).fill(venue).join(',') } }), { status: 400 });
});

function freshVenue() {
  const path = `/venue/ticketmaster-completion-${seq++}`;
  snapshots.set(path, { path, venue: { name: 'Completion Room', place: 'Toronto, Ontario, Canada', source: 'ticketmaster', providerVenueId: path.slice(7) } });
  return path;
}
function sessionsFor(actor) {
  q.insertSession.run(`s_${seq++}`, actor.id, now(), now() + 100000, null, null);
  db.prepare('INSERT INTO newsroom_browser_sessions(token_hash,user_id,created_at,expires_at,auth_role) VALUES(?,?,?,?,?)').run(`n_${seq++}`, actor.id, now(), now() + 100000, actor.role);
}
const sessionCount = actor => db.prepare('SELECT count(*) n FROM sessions WHERE user_id=?').get(actor.id).n
  + db.prepare('SELECT count(*) n FROM newsroom_browser_sessions WHERE user_id=?').get(actor.id).n;
const registered = path => db.prepare("SELECT * FROM creator_entities WHERE entity_type='venue' AND entity_key=?").get(path);

test('reviewed conversion requires recorded consent, invalidates sessions and rolls back with its audit', () => {
  const path = freshVenue(), actor = user(), staff = user('admin');
  assert.throws(() => run('POST /api/venue-community/claims', actor, { path, website: 'https://venue.example.test', note: 'Official office and venue management details.' }), { status: 400 });
  const pending = claim(actor, path).claim;
  assert.equal(q.userById.get(actor.id).role, 'fan'); assert.equal(registered(path), undefined);
  sessionsFor(actor); assert.equal(sessionCount(actor), 2);
  db.prepare('UPDATE venue_claims SET conversion_consent=NULL WHERE id=?').run(pending.id);
  assert.throws(() => review(staff, pending.id), { status: 409 });
  assert.equal(claim(actor, path).claim.id, pending.id, 'renewed consent retains the pending claim');
  auditFailure = true;
  try { assert.throws(() => review(staff, pending.id), /Audit unavailable/); } finally { auditFailure = false; }
  assert.equal(q.userById.get(actor.id).role, 'fan'); assert.equal(registered(path), undefined); assert.equal(sessionCount(actor), 2);
  assert.equal(read(actor, path).claim.status, 'pending');
  review(staff, pending.id);
  assert.equal(q.userById.get(actor.id).role, 'venue'); assert.equal(registered(path).owner_id, actor.id); assert.equal(sessionCount(actor), 0);
  assert.equal(managedCreatorEntity(db, actor.id, 'venue', path).entityKey, path);
  sessionsFor(q.userById.get(actor.id));
  review(staff, pending.id, 'revoked'); assert.equal(q.userById.get(actor.id).role, 'fan'); assert.equal(sessionCount(actor), 0);
});

test('conflicting retained identities and changed staff authorization fail without conversion', () => {
  const path = freshVenue(), staff = user('admin');
  for (const kind of ['artist-name', 'artist-owner', 'event-owner', 'stale-venue-owner']) {
    const actor = user(), pending = claim(actor, path).claim;
    if (kind === 'artist-name') db.prepare("UPDATE users SET artist_name='Retained identity' WHERE id=?").run(actor.id);
    else if (kind === 'artist-owner') db.prepare('INSERT INTO artist_profiles(artist_key,owner_id,updated_at) VALUES(?,?,?)').run(`conflict_${seq++}`, actor.id, now());
    else db.prepare("INSERT INTO creator_entities(entity_type,entity_key,name,owner_id,status) VALUES(?,?,?,?,'held')").run(kind === 'event-owner' ? 'event' : 'venue', `conflict_${seq++}`, 'Retained page', actor.id);
    assert.throws(() => review(staff, pending.id), { status: 403 }); assert.equal(q.userById.get(actor.id).role, 'fan');
  }
  const actor = user(), pending = claim(actor, path).claim;
  assert.throws(() => run('POST /api/admin/venue-claims/:id/review', staff, { decision: 'rejected', note: 'Reviewed the request and declined access.' }, { params: { id: pending.id }, assertCurrentSession() { db.prepare("UPDATE users SET role='fan' WHERE id=?").run(staff.id); } }), { status: 403 });
  assert.equal(read(actor, path).claim.status, 'pending');
});

test('revoking the held or removed page itself preserves that status and unrelated owned pages', () => {
  for (const status of ['held', 'removed']) {
    const path = freshVenue(), other = freshVenue(), actor = user(), staff = user('admin');
    const first = claim(actor, path).claim; review(staff, first.id);
    const second = claim(actor, other).claim; review(staff, second.id);
    db.prepare('UPDATE creator_entities SET status=? WHERE entity_key IN (?,?)').run(status, path, other);
    sessionsFor(q.userById.get(actor.id));
    assert.throws(() => review(staff, first.id, 'revoked', { revocationConfirmed: false }), { status: 400 });
    assert.throws(() => review(staff, first.id, 'revoked', { expectedOwnerId: 'someone-else' }), { status: 400 });
    review(staff, first.id, 'revoked');
    assert.equal(registered(path).status, status); assert.equal(registered(path).owner_id, null);
    assert.equal(registered(other).status, status); assert.equal(registered(other).owner_id, actor.id);
    assert.equal(q.userById.get(actor.id).role, 'venue'); assert.equal(sessionCount(actor), 0);
    review(staff, second.id, 'revoked'); assert.equal(q.userById.get(actor.id).role, 'fan'); assert.equal(registered(other).status, status);
  }
});

test('all claim statuses are reachable beyond 100 rows and older approved access remains revocable', () => {
  const actor = user(), staff = user('admin'), ids = [];
  for (let i = 0; i < 125; i++) { const pending = claim(actor, freshVenue()).claim; review(staff, pending.id); ids.push(pending.id); }
  const walk = (route, who, status) => {
    const ids = [], seen = new Set(); let after = null;
    do { const page = run(route, who, {}, { query: { status, after } }); assert.ok(page.claims.length <= 20);
      for (const item of page.claims) { assert.equal(seen.has(item.id), false); seen.add(item.id); ids.push(item.id); if (route.includes('/me/')) { assert.equal('review_note' in item, false); assert.equal('reviewer_id' in item, false); } }
      after = page.nextCursor;
    } while (after);
    return ids;
  };
  assert.deepEqual(new Set(walk('GET /api/me/venue-claims', actor, 'approved')), new Set(ids));
  assert.ok(walk('GET /api/admin/venue-claims', staff, 'approved').includes(ids[0]));
  review(staff, ids[0], 'revoked');
  assert.ok(walk('GET /api/me/venue-claims', actor, 'revoked').includes(ids[0]));
  assert.equal(walk('GET /api/me/venue-claims', user(), 'all').length, 0);
  for (const status of ['pending', 'approved', 'rejected', 'revoked', 'cancelled', 'all']) walk('GET /api/admin/venue-claims', staff, status);
  const first = run('GET /api/me/venue-claims', actor, {}, { query: { status: 'approved' } });
  assert.throws(() => run('GET /api/me/venue-claims', actor, {}, { query: { status: 'all', after: first.nextCursor } }), { status: 400 });
});

const creatorRoutes = creatorPostRoutes({ database: db, requireUser, rateLimit() {}, artistIdentity: key => ({ aliases: [key] }), readPost: () => ({ post: null }),
  resolveUnclaimedEntity: (type, key) => type === 'venue' ? canonicalVenueCreatorTarget(path => snapshots.get(path), key) : null });
const creator = (route, actor, path, body = {}) => creatorRoutes[route]({ user: actor, body, params: { type: 'venue', key: encodeURIComponent(path) }, setHeader() {} });

test('trusted unclaimed venue reads stay read-only; following provisions owner-null without any grant', () => {
  const path = freshVenue(), actor = user();
  assert.equal(creator('GET /api/creators/:type/:key/follow', actor, path).following, false);
  assert.deepEqual(creator('GET /api/creators/:type/:key/posts', null, path), { posts: [] });
  assert.equal(registered(path), undefined);
  for (const bad of ['/venue/invented', '/venue/legacy-room', '/venue/unknown%00']) assert.throws(() => creator('PUT /api/creators/:type/:key/follow', actor, bad, { following: true, notifyUpdates: true, ownerId: actor.id, name: 'Invented' }), { status: 404 });
  creator('PUT /api/creators/:type/:key/follow', actor, path, { following: true, notifyUpdates: false, ownerId: actor.id, name: 'Forged' });
  assert.equal(registered(path).owner_id, null); assert.equal(registered(path).name, 'Completion Room'); assert.equal(q.userById.get(actor.id).role, 'fan');
  assert.equal(managedCreatorEntity(db, actor.id, 'venue', path), null);
  assert.deepEqual(creator('PUT /api/creators/:type/:key/follow', actor, path, { following: false }), { following: false, notifyUpdates: false });
  assert.deepEqual(creator('PUT /api/creators/:type/:key/follow', actor, path, { following: true }), { following: true, notifyUpdates: false });
  assert.throws(() => creator('PUT /api/creators/:type/:key/follow', actor, path, { following: true, notifyUpdates: null }), { status: 400 });
  creator('PUT /api/creators/:type/:key/follow', actor, path, { following: true, notifyUpdates: true });
  assert.equal(db.prepare("SELECT count(*) n FROM creator_follows WHERE account_id=? AND entity_type='venue' AND entity_key=?").get(actor.id, path).n, 1);
  for (const status of ['held', 'removed']) {
    db.prepare('UPDATE creator_entities SET status=? WHERE entity_key=?').run(status, path);
    assert.throws(() => creator('PUT /api/creators/:type/:key/follow', actor, path, { following: true, notifyUpdates: true }), { status: 404 });
    assert.equal(registered(path).status, status); assert.equal(registered(path).owner_id, null);
  }
});

test('unclaimed follow -> reviewed conversion -> shared post and follower inbox -> revocation', async () => {
  const path = freshVenue(), actor = user(), fan = user(), staff = user('admin');
  creator('PUT /api/creators/:type/:key/follow', fan, path, { following: true, notifyUpdates: true });
  const update = { version: 1, entityType: 'venue', entityKey: path, kind: 'update', title: 'Doors open at seven', date: '', location: '', url: '' };
  const pending = claim(actor, path).claim;
  assert.throws(() => assertCreatorUpdate(db, actor.id, { kind: 'status', creatorUpdate: update }), { status: 403 });
  review(staff, pending.id); const operator = q.userById.get(actor.id);
  const { routes: app } = await import('../../api.js');
  const body = { clientMutationId: `venue_completion_${actor.id}`, kind: 'status', review: 'See you at the show.', creatorUpdate: update };
  const context = { user: operator, body, params: {}, query: {}, ip: actor.id };
  const posted = app['POST /api/posts'](context);
  assert.equal(app['POST /api/posts'](context).id, posted.id);
  assert.equal(db.prepare("SELECT count(*) n FROM notifications WHERE user_id=? AND post_id=? AND type='creator_update'").get(fan.id, posted.id).n, 1);
  const listed = app['GET /api/creators/:type/:key/posts']({ ...context, user: fan, params: { type: 'venue', key: encodeURIComponent(path) } });
  assert.equal(listed.posts[0].id, posted.id);
  assert.equal(registered(path).owner_id, actor.id, 'follow provisioning never replaces the approved owner');
  review(staff, pending.id, 'revoked');
  assert.throws(() => app['POST /api/posts']({ ...context, body: { ...body, clientMutationId: `after_revoke_${actor.id}` } }), { status: 403 });
  assert.equal(db.prepare("SELECT following FROM creator_follows WHERE account_id=? AND entity_key=?").get(fan.id, path).following, 1);
});

test('legacy claims gain consent fields without manufacturing approval or consent; migration is repeatable', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { ensureVenueCommunitySchema } = await import('./schema.js');
  const legacy = new DatabaseSync(':memory:');
  try {
    legacy.exec(`CREATE TABLE users(id TEXT PRIMARY KEY);
      CREATE TABLE venue_reviews(venue_key TEXT,user_id TEXT,removed INTEGER);
      CREATE TABLE venue_claims(id TEXT PRIMARY KEY,venue_path TEXT,venue_name TEXT,user_id TEXT,website TEXT,note TEXT,
        status TEXT,created_at INTEGER,reviewed_at INTEGER,reviewer_id TEXT,review_method TEXT,review_reference TEXT,review_note TEXT);
      INSERT INTO venue_claims(id,venue_path,user_id,status,created_at) VALUES('legacy','/venue/old','member','pending',123);`);
    ensureVenueCommunitySchema(legacy); ensureVenueCommunitySchema(legacy);
    const row = legacy.prepare('SELECT * FROM venue_claims').get();
    assert.equal(row.status, 'pending'); assert.equal(row.created_at, 123);
    assert.equal(row.conversion_consent, null); assert.equal(row.conversion_consent_at, null); assert.equal(row.account_role_at_request, null);
    assert.equal(legacy.prepare('SELECT count(*) n FROM venue_claims').get().n, 1);
  } finally { legacy.close(); }
});

test('claim consent is portable only to its applicant, backed up, and erased with the account', async () => {
  const { routes: app } = await import('../../api.js');
  const { hashPassword } = await import('../../auth.js');
  const { backupSourceManifest } = await import('../../../scripts/backup-db-verification.mjs');
  const actor = user(), other = user(), path = freshVenue();
  const mine = claim(actor, path).claim; const theirs = claim(other, path).claim;
  const password = 'Venue-claim-export-fixture1';
  db.prepare('UPDATE users SET pass_hash=? WHERE id=?').run(hashPassword(password), actor.id);
  const context = { user: q.userById.get(actor.id), body: { password }, query: {}, params: {}, setHeader() {} };
  const exported = await app['POST /api/me/export'](context);
  assert.deepEqual(exported.venueClaims.map(row => row.id), [mine.id]);
  assert.equal(exported.venueClaims[0].conversion_consent, 'venue-account-v1');
  assert.equal(exported.venueClaims[0].account_role_at_request, 'fan');
  assert.ok(exported.venueClaims[0].conversion_consent_at);
  assert.equal(Object.hasOwn(exported.venueClaims[0], 'reviewer_id'), false);
  assert.equal(backupSourceManifest(db).venue_claims.minimumRows, db.prepare('SELECT count(*) n FROM venue_claims').get().n);
  await app['DELETE /api/me'](context);
  assert.equal(db.prepare('SELECT 1 FROM venue_claims WHERE id=?').get(mine.id), undefined);
  assert.ok(db.prepare('SELECT 1 FROM venue_claims WHERE id=?').get(theirs.id));
});
