import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { registerPitSqliteFunctions } from './sqliteFunctions.js';
import { ensureVenueCommunitySchema } from './features/venueCommunity/schema.js';

test('an already installed unique index is replaced idempotently without rewriting review rows', () => {
  const database = new DatabaseSync(':memory:');
  try {
    database.exec(`CREATE TABLE users(id TEXT PRIMARY KEY);
      CREATE TABLE venue_reviews(id TEXT PRIMARY KEY,venue_key TEXT,user_id TEXT,rating REAL,text TEXT,created_at INTEGER,removed INTEGER DEFAULT 0);
      INSERT INTO venue_reviews VALUES('existing','/venue/existing','owner',4.2,'Keep this note',10,0);
      CREATE UNIQUE INDEX idx_venue_canonical_rating ON venue_reviews(venue_key,user_id) WHERE venue_key LIKE '/venue/%' AND removed=0;`);
    ensureVenueCommunitySchema(database); ensureVenueCommunitySchema(database);
    assert.deepEqual({ ...database.prepare('SELECT * FROM venue_reviews').get() }, { id:'existing',venue_key:'/venue/existing',user_id:'owner',rating:4.2,text:'Keep this note',created_at:10,removed:0,updated_at:null });
    const indexes = database.prepare('PRAGMA index_list(venue_reviews)').all();
    assert.equal(indexes.some(row => row.name === 'idx_venue_canonical_rating'),false);
    assert.equal(indexes.find(row => row.name === 'idx_venue_member_history').unique,0);
  } finally { database.close(); }
});

test('old duplicate canonical reviews survive real repeated startup, latest-valid reads and serialized edits', { timeout: 60000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pit-venue-upgrade-'));
  const worker = fileURLToPath(new URL('./fixtures/venueUpgradeWorker.mjs', import.meta.url));
  const env = { ...process.env, PIT_DATA_DIR: directory };
  delete env.NODE_TEST_CONTEXT;
  const parse = (output) => JSON.parse(output.trim().split(/\r?\n/).at(-1));
  const run = (...args) => {
    const result = spawnSync(process.execPath, [worker, ...args], { env, encoding: 'utf8', windowsHide: true, timeout: 15000 });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    return parse(result.stdout);
  };
  const concurrent = (...args) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [worker, ...args], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', error = '';
    child.stdout.on('data', part => { output += part; }); child.stderr.on('data', part => { error += part; });
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve(parse(output)) : reject(Error(error)));
  });
  let database;
  try {
    const { path } = run('seed');
    database = new DatabaseSync(join(directory, 'pit.db'));
    registerPitSqliteFunctions(database);
    // Recreate the predecessor's schema and accepted data, including duplicate
    // /venue/ keys. Migration must run before any API repairs can be attempted.
    database.exec('DROP INDEX IF EXISTS idx_venue_canonical_rating; DROP INDEX IF EXISTS idx_venue_member_history; ALTER TABLE venue_reviews DROP COLUMN updated_at');
    const insert = (id, user, rating, at, removed = 0) => database.prepare(`INSERT INTO venue_reviews
      (id,venue_key,user_id,rating,text,photos,photos_public,created_at,removed) VALUES(?,?,?,?,?,'[]',0,?,?)`)
      .run(id, path, user, rating, `Historical authored note ${id}. Preserve all of this text.`, at, removed);
    for (const user of ['visible', 'private', 'members', 'reported', 'removed', 'suspended', 'blocked']) {
      insert(`${user}_old`, user, 2.5, 10);
      insert(`${user}_latest`, user, 4.2, 20);
      insert(`${user}_invalid`, user, 6, 30);
    }
    insert('visible_tie_z', 'visible', 4.5, 20);
    database.prepare("UPDATE venue_reviews SET removed=1 WHERE user_id='removed'").run();
    database.prepare("INSERT INTO reports(id,reporter_id,target_type,target_id,reason,status,created_at) VALUES('upgrade-report','viewer','venue_review','reported_latest','other','open',40)").run();
    const before = database.prepare('SELECT * FROM venue_reviews ORDER BY id').all().map(row => ({ ...row }));
    const reports = database.prepare('SELECT * FROM reports ORDER BY id').all();
    const guest = run('read', 'guest');
    assert.deepEqual(guest.rating, { count: 3, average: 3.73 }); // visible 4.5, reported fallback 2.5, blocked 4.2
    assert.deepEqual(guest.stats, guest.publicStats);
    const viewer = run('read', 'viewer');
    assert.deepEqual(viewer.rating, { count: 3, average: 3.73 }); // members replaces blocked
    const own = run('read', 'visible');
    assert.equal(own.myReview.id, 'visible_tie_z');
    assert.equal(own.myReview.rating, 4.5);
    assert.deepEqual(database.prepare('SELECT * FROM venue_reviews ORDER BY id').all().map(({ updated_at, ...row }) => row), before);
    assert.ok(database.prepare('SELECT updated_at FROM venue_reviews').all().every(row => row.updated_at === null));
    assert.deepEqual(database.prepare('SELECT * FROM reports ORDER BY id').all(), reports);
    assert.equal(run('write', 'reported').status, 409, 'A held latest valid review cannot be edited around its report');
    const changed = run('write', 'visible');
    assert.equal(changed.myReview.id, 'visible_tie_z'); assert.equal(changed.myReview.rating, 3.5);
    assert.deepEqual(run('read', 'guest').rating, { count: 3, average: 3.4 });
    for (const old of before.filter(row => row.id !== 'visible_tie_z')) {
      const { updated_at, ...current } = database.prepare('SELECT * FROM venue_reviews WHERE id=?').get(old.id);
      assert.deepEqual(current, old); assert.equal(updated_at, null);
    }
    const writes = await Promise.all([concurrent('write', 'new_writer', '0.5'), concurrent('write', 'new_writer', '4.5')]);
    assert.equal(writes[0].myReview.id, writes[1].myReview.id, 'Concurrent writes reuse the same canonical record');
    assert.equal(database.prepare("SELECT count(*) n FROM venue_reviews WHERE user_id='new_writer'").get().n, 1);
    assert.ok([0.5, 4.5].includes(run('read', 'new_writer').myReview.rating));
    const precise = run('write', 'private', '4.2');
    assert.equal(precise.myReview.id, 'private_latest'); assert.equal(precise.myReview.rating, 4.2);
    assert.equal(precise.myReview.text, 'An explicitly edited venue note.');
    assert.equal(run('write', 'private', '4.3').status, 400, 'New precise values remain invalid');
    assert.equal(run('write', 'private', '4.5').myReview.rating, 4.5);
    assert.equal(run('write', 'private', '4.2').status, 400, 'A stale precise edit cannot restore a replaced score');
    assert.equal(database.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  } finally { database?.close(); rmSync(directory, { recursive: true, force: true }); }
});
