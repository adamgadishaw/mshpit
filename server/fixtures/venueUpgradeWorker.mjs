// Disposable upgrade fixture. Never opens the default development database.
import assert from 'node:assert/strict';
import { basename } from 'node:path';
assert.ok(basename(process.env.PIT_DATA_DIR || '').startsWith('pit-venue-upgrade-'));
const { db, q } = await import('../db.js');
const { routes } = await import('../api.js');
const { venuePath } = await import('../../src/domain/urls.mjs');
const { publicDocumentForPath } = await import('../seo.js');
const path = venuePath({ name: 'Upgrade Hall', source: 'ticketmaster', providerVenueId: 'upgrade-hall' });
const [mode, account = 'visible', value = '3.5'] = process.argv.slice(2);
const user = () => q.userById.get(account);
const context = () => ({ user: user(), ip: 'upgrade-fixture', query: { path }, body: { path, rating: Number(value), text: 'An explicitly edited venue note.' } });
try {
  if (mode === 'seed') {
    for (const id of ['visible', 'private', 'members', 'reported', 'removed', 'suspended', 'blocked', 'viewer', 'new_writer']) {
      q.insertUser.run(id, `${id}@example.test`, id, id, 'synthetic', 'fan', 'Toronto', 0, 0, 'CA', '#111111', 1);
      db.prepare('UPDATE users SET email_verified_at=1 WHERE id=?').run(id);
    }
    db.prepare("UPDATE users SET profile_audience='only_me' WHERE id='private'").run();
    db.prepare("UPDATE users SET profile_audience='members' WHERE id='members'").run();
    db.prepare("UPDATE users SET suspended_until=? WHERE id='suspended'").run(Date.now() + 86400000);
    db.prepare("INSERT INTO blocks(blocker_id,blocked_id,created_at) VALUES('blocked','viewer',1)").run();
    db.prepare(`INSERT INTO tour_dates(id,artist,venue,place,date,source,updated_at,release_at,provider_active,music_qualified,
      venue_provider_id,venue_city,venue_region,venue_country_code,venue_country)
      VALUES('upgrade-show','Fixture Artist','Upgrade Hall','Toronto, Ontario, Canada','2099-01-01','ticketmaster',1,0,1,1,
        'upgrade-hall','Toronto','Ontario','CA','Canada')`).run();
    console.log(JSON.stringify({ path }));
  } else if (mode === 'read') {
    const result = routes['GET /api/venue-community'](context());
    const publicStats = publicDocumentForPath(path).venueReviewStats;
    console.log(JSON.stringify({ ...result, publicStats }));
  } else if (mode === 'write') {
    try { console.log(JSON.stringify(routes['PUT /api/venue-community/rating'](context()))); }
    catch (error) { console.log(JSON.stringify({ status: error.status, code: error.code })); }
  } else throw Error('Unknown upgrade fixture mode');
} finally { db.close(); }
