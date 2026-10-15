import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
const moduleUrl = new URL('./db.js', import.meta.url).href;
function boot(directory, setup = '') {
  const env = Object.fromEntries(['PATH','SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','LOCALAPPDATA']
    .filter(key => process.env[key]).map(key => [key,process.env[key]]));
  Object.assign(env,{ NODE_ENV:'test', PIT_DATA_DIR:directory, PIT_ALLOW_EMPTY_DB_BOOTSTRAP:'true' });
  return spawnSync(process.execPath,['--input-type=module','-e', `const { db,q } = await import(${JSON.stringify(moduleUrl)}); ${setup}; db.close();`],
    { env, encoding:'utf8', windowsHide:true, timeout:15000 });
}
function legacyFixture(directory) {
  const initialized = boot(directory, `q.insertUser.run('legacy_member','legacy@example.test','Legacy Fixture','legacyfixture','hash','fan',null,null,null,'LF','#123456',12345);
    db.prepare('UPDATE users SET email_verified_at=45678,is_banned=1 WHERE id=?').run('legacy_member')`);
  assert.equal(initialized.status,0,initialized.stderr);
  const db = new DatabaseSync(join(directory,'pit.db'));
  db.exec(`DROP TRIGGER users_email_verification_revision;
    ALTER TABLE users DROP COLUMN email_verification_revision;
    ALTER TABLE users DROP COLUMN email_verification_method;`);
  return db;
}
const hasColumn = (db,name) => db.prepare('PRAGMA table_info(users)').all().some(row => row.name === name);

test('additive verification migration preserves legacy state, survives restart, and tolerates old-style writes', () => {
  const directory = mkdtempSync(join(tmpdir(),'pit-verification-upgrade-'));
  let db;
  try {
    db = legacyFixture(directory); db.close(); db = null;
    const upgraded = boot(directory); assert.equal(upgraded.status,0,upgraded.stderr);
    db = new DatabaseSync(join(directory,'pit.db'));
    const row = db.prepare('SELECT * FROM users WHERE id=?').get('legacy_member');
    assert.equal(row.email_verified_at,45678); assert.equal(row.is_banned,1);
    assert.equal(row.email_verification_method,null); assert.equal(row.email_verification_revision,0);
    const columns = db.prepare('PRAGMA table_info(users)').all();
    assert.equal(columns.find(c => c.name === 'email_verification_method').notnull,0);
    assert.equal(columns.find(c => c.name === 'email_verification_revision').notnull,1);
    // Existing code can still write addresses; the DB maintains the new revision.
    db.prepare('UPDATE users SET email=? WHERE id=?').run('new-legacy@example.test','legacy_member');
    db.close(); db = null;
    const restart = boot(directory); assert.equal(restart.status,0,restart.stderr);
    db = new DatabaseSync(join(directory,'pit.db'));
    assert.equal(db.prepare('SELECT email_verification_revision n FROM users WHERE id=?').get('legacy_member').n,1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND name='users_email_verification_revision'").get().n,1);
  } finally { db?.close(); rmSync(directory,{recursive:true,force:true}); }
});

test('a later startup migration failure rolls back both new columns and the revision trigger, then retries cleanly', () => {
  const directory = mkdtempSync(join(tmpdir(),'pit-verification-upgrade-failure-'));
  let db;
  try {
    db = legacyFixture(directory);
    db.prepare(`INSERT INTO media_assets(id,owner_id,client_asset_id,create_hash,purpose,kind,source_key,source_url,original_name,mime_type,byte_size,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('migration_failure_asset','legacy_member','fixture','hash','post','image','fixture/source','https://example.test/fixture','fixture.jpg','image/jpeg',1,1,1);
    db.exec(`CREATE TRIGGER synthetic_migration_failure BEFORE UPDATE OF codec_status ON media_assets
      WHEN NEW.id='migration_failure_asset' BEGIN SELECT RAISE(ABORT,'synthetic migration failure'); END`);
    db.close(); db = null;
    const failed = boot(directory); assert.notEqual(failed.status,0); assert.match(failed.stderr,/synthetic migration failure/);
    db = new DatabaseSync(join(directory,'pit.db'));
    assert.equal(hasColumn(db,'email_verification_method'),false);
    assert.equal(hasColumn(db,'email_verification_revision'),false);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND name='users_email_verification_revision'").get().n,0);
    assert.equal(db.prepare('SELECT email_verified_at n FROM users WHERE id=?').get('legacy_member').n,45678);
    db.exec('DROP TRIGGER synthetic_migration_failure'); db.close(); db = null;
    const recovered = boot(directory); assert.equal(recovered.status,0,recovered.stderr);
    db = new DatabaseSync(join(directory,'pit.db'));
    assert.equal(hasColumn(db,'email_verification_method'),true);
    assert.equal(hasColumn(db,'email_verification_revision'),true);
  } finally { db?.close(); rmSync(directory,{recursive:true,force:true}); }
});
