import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { venuePath } from '../src/domain/urls.mjs';
const directory = mkdtempSync(join(tmpdir(), 'pit-venue-score-integration-'));
process.env.PIT_DATA_DIR = directory;
const { db, q } = await import('./db.js');
const { routes } = await import('./api.js');
const { publicDocumentForPath, resolveVenueReviewKeys } = await import('./seo.js');
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
let seq = 0;
function member(audience = 'everyone') {
  const id = `venue_score_${++seq}`;
  q.insertUser.run(id, `${id}@example.test`, id, id, 'hash', 'fan', 'Toronto', 43, -79, 'VS', '#111111', Date.now());
  db.prepare('UPDATE users SET email_verified_at=?,profile_audience=? WHERE id=?').run(Date.now(), audience, id);
  return q.userById.get(id);
}
function venue(name = `Integration Hall ${++seq}`, city = 'Toronto') {
  const id = `score-room-${++seq}`;
  db.prepare(`INSERT INTO tour_dates(id,artist,venue,place,date,source,updated_at,release_at,provider_active,music_qualified,
    venue_provider_id,venue_city,venue_region,venue_country_code,venue_country)
    VALUES(?, 'Integration Artist', ?, ?, '2099-01-01', 'ticketmaster', 1, 0, 1, 1, ?, ?, 'Ontario', 'CA', 'Canada')`)
    .run(id, name, `${city}, Ontario, Canada`, id, city);
  return { name, path: venuePath({ name, source: 'ticketmaster', providerVenueId: id }) };
}
function legacy(room, user, rating, at, key = room.name.toLowerCase()) {
  const id = `legacy_score_${++seq}`;
  db.prepare('INSERT INTO venue_reviews(id,venue_key,user_id,rating,text,created_at) VALUES(?,?,?,?,?,?)').run(id, key, user.id, rating, '', at);
  return id;
}
const read = (room, user = null, after = null) => routes['GET /api/venue-community']({ user, ip: `read-${++seq}`, query: { path: room.path, after } });
const save = (room, user, rating, text = '') => routes['PUT /api/venue-community/rating']({ user, ip: `save-${++seq}`, body: { path: room.path, rating, text } });
const oldRead = (room, user = null) => routes['GET /api/venues/:key/reviews']({ user, ip: `legacy-${++seq}`, params: { key: encodeURIComponent(room.name) }, query: {} });
const publicStats = room => publicDocumentForPath(room.path).venueReviewStats;

test('canonical half-stars and proven legacy notes produce one member score in app and public pages', () => {
  const room = venue(), first = member(), second = member();
  legacy(room, first, 4.5, 1); legacy(room, second, 3.5, 2);
  const saved = save(room, first, 0.5);
  assert.equal(saved.myReview.rating, 0.5);
  assert.equal(saved.myReview.text, '');
  assert.deepEqual(saved.rating, { count: 2, average: 2 });
  assert.deepEqual(read(room).stats, publicStats(room));
  assert.deepEqual(oldRead(room).stats, read(room).stats);
  assert.equal(db.prepare('SELECT count(*) n FROM venue_reviews WHERE user_id=?').get(first.id).n, 2, 'Historical rows are not migrated or rewritten');
});

test('canonical edits retain their ID and creation time while their edit time chooses the latest valid score', () => {
  const room = venue(), author = member();
  const original = save(room, author, 2.5).myReview;
  db.prepare('UPDATE venue_reviews SET created_at=10,updated_at=NULL WHERE id=?').run(original.id);
  legacy(room, author, 4.5, 20);
  assert.equal(read(room).rating.average, 4.5);
  const changed = save(room, author, 3.5, 'A helpful note about this room.');
  assert.equal(changed.myReview.id, original.id);
  assert.equal(changed.rating.average, 3.5);
  const row = db.prepare('SELECT created_at,updated_at FROM venue_reviews WHERE id=?').get(original.id);
  assert.equal(row.created_at, 10); assert.ok(row.updated_at > 20);
  assert.equal(save(room, author, 3.5, 'A helpful note about this room.').myReview.id, original.id);
  assert.deepEqual(read(room).stats, publicStats(room));
});

test('invalid historical scores do not erase an older precise valid score', () => {
  const room = venue(), author = member();
  legacy(room, author, 4.2, 10); legacy(room, author, 6, 20);
  assert.equal(read(room).rating.average, 4.2);
  assert.deepEqual(read(room).stats, publicStats(room));
});

test('same-named venues in different cities never inherit unlocated historical scores', () => {
  const name = `Namesake Hall ${++seq}`, toronto = venue(name), ottawa = venue(name, 'Ottawa');
  const author = member(); legacy(toronto, author, 4.5, 1);
  save(toronto, author, 2); save(ottawa, author, 5);
  assert.deepEqual(resolveVenueReviewKeys({ venueKey: name, canonicalPath: toronto.path }), [toronto.path]);
  assert.equal(read(toronto).rating.average, 2); assert.equal(read(ottawa).rating.average, 5);
  assert.equal(oldRead(toronto).stats.averageRating, 4.5, 'Unlocated notes remain in their separate legacy namespace');
  assert.deepEqual(read(toronto).stats, publicStats(toronto)); assert.deepEqual(read(ottawa).stats, publicStats(ottawa));
});

test('audiences, open reports, account state and both block directions apply before every aggregate', () => {
  const room = venue(), publicAuthor = member(), membersAuthor = member('members'), privateAuthor = member('only_me');
  const reported = member(), removed = member(), suspended = member(), blocked = member(), viewer = member();
  const publicRow = legacy(room, publicAuthor, 4, 1);
  legacy(room, membersAuthor, 2, 2); legacy(room, privateAuthor, 1, 3);
  const reportId = legacy(room, reported, 5, 4), removedId = legacy(room, removed, 5, 5);
  legacy(room, suspended, 5, 6); legacy(room, blocked, 3, 7);
  db.prepare("INSERT INTO reports(id,reporter_id,target_type,target_id,reason,status,created_at) VALUES(?,?,'venue_review',?,'other','open',?)").run(`score_report_${++seq}`, viewer.id, reportId, Date.now());
  db.prepare('UPDATE venue_reviews SET removed=1 WHERE id=?').run(removedId);
  db.prepare('UPDATE users SET suspended_until=? WHERE id=?').run(Date.now() + 600000, suspended.id);
  db.prepare('INSERT INTO blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)').run(blocked.id, viewer.id, Date.now());
  assert.deepEqual(read(room).rating, { count: 2, average: 3.5 });
  assert.deepEqual(read(room).stats, publicStats(room));
  assert.deepEqual(read(room, viewer).rating, { count: 2, average: 3 });
  assert.deepEqual(oldRead(room, viewer).stats, read(room, viewer).stats);
  assert.deepEqual(oldRead(room, viewer).reviews.map(row => row.id).sort(), [publicRow, db.prepare('SELECT id FROM venue_reviews WHERE user_id=?').get(membersAuthor.id).id].sort());
  db.prepare('DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?').run(blocked.id, viewer.id);
  db.prepare('INSERT INTO blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)').run(viewer.id, blocked.id, Date.now());
  assert.deepEqual(read(room, viewer).rating, { count: 2, average: 3 });
});

test('removing a canonical rating reveals eligible history without changing that history', () => {
  const room = venue(), author = member();
  const old = legacy(room, author, 3.5, 1); save(room, author, 5);
  const result = routes['DELETE /api/venue-community/rating']({ user: author, ip: `remove-${++seq}`, body: { path: room.path } });
  assert.deepEqual(result.rating, { count: 1, average: 3.5 });
  assert.equal(db.prepare('SELECT rating FROM venue_reviews WHERE id=?').get(old).rating, 3.5);
});

test('page boundaries never change the complete per-member score', () => {
  const room = venue();
  for (let i = 0; i < 25; i++) save(room, member(), i === 0 ? 0.5 : 4);
  const first = read(room), second = read(room, null, first.nextCursor);
  assert.equal(first.reviews.length, 20); assert.equal(second.reviews.length, 5);
  assert.equal(first.rating.count, 25); assert.deepEqual(first.stats, second.stats);
  assert.deepEqual(first.stats, publicStats(room));
});
