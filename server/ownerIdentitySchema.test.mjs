import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { ensureOwnerIdentitySchema } from "./ownerIdentitySchema.js";

const marker = "security.bootstrap_admin_identity.v1";
function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE app_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT NOT NULL,role TEXT NOT NULL,
      is_banned INTEGER NOT NULL DEFAULT 0,suspended_until INTEGER,email_verified_at INTEGER NOT NULL,
      name TEXT NOT NULL);
    INSERT INTO users VALUES('owner','owner@example.test','admin',0,NULL,1,'Owner');
    CREATE TRIGGER owner_identity_no_update BEFORE UPDATE ON app_meta
      WHEN OLD.key='security.bootstrap_admin_identity.v1' AND json_extract(OLD.value,'$.version')=2
        AND NEW.value<>OLD.value
      BEGIN SELECT RAISE(ABORT,'legacy identity guard'); END;
    CREATE TRIGGER owner_account_security_boundary BEFORE UPDATE ON users
      WHEN OLD.id=(SELECT json_extract(value,'$.userId') FROM app_meta
        WHERE key='security.bootstrap_admin_identity.v1') AND NEW.id<>OLD.id
      BEGIN SELECT RAISE(ABORT,'legacy account guard'); END;`);
  db.prepare("INSERT INTO app_meta VALUES(?,?)").run(marker, JSON.stringify({ version: 2, userId: "owner", email: "owner@example.test" }));
  return db;
}

test("existing Owner guards upgrade atomically and reject key moves and null identities", () => {
  const db = fixture();
  try {
    const before = db.prepare("SELECT value FROM app_meta WHERE key=?").get(marker).value;
    ensureOwnerIdentitySchema(db);
    ensureOwnerIdentitySchema(db);
    for (const key of ["different-key", "", null]) {
      assert.throws(() => db.prepare("UPDATE app_meta SET key=? WHERE key=?").run(key, marker), /Owner identity is locked/);
    }
    assert.throws(() => db.prepare("UPDATE app_meta SET value='{}' WHERE key=?").run(marker), /Owner identity is locked/);
    assert.throws(() => db.prepare("UPDATE users SET id=NULL WHERE id='owner'").run(), /Owner account security boundary/);
    assert.throws(() => db.prepare("UPDATE users SET id='replacement' WHERE id='owner'").run(), /Owner account security boundary/);
    assert.throws(() => db.prepare("UPDATE users SET role='fan' WHERE id='owner'").run(), /Owner account security boundary/);
    assert.equal(db.prepare("SELECT value FROM app_meta WHERE key=?").get(marker).value, before);
    db.prepare("UPDATE app_meta SET value=value,key=key WHERE key=?").run(marker);
    db.prepare("UPDATE users SET name='Updated branding' WHERE id='owner'").run();
    assert.equal(db.prepare("SELECT name FROM users WHERE id='owner'").get().name, "Updated branding");
    db.prepare("INSERT INTO app_meta VALUES('unrelated','{}')").run();
    db.prepare("UPDATE app_meta SET key='ordinary' WHERE key='unrelated'").run();
    assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  } finally { db.close(); }
});

test("a failed guard replacement restores the prior triggers and releases its savepoint", () => {
  const db = fixture();
  try {
    const before = db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name").all();
    db.exec("DROP TABLE users");
    assert.throws(() => ensureOwnerIdentitySchema(db), /no such table/);
    assert.deepEqual(db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name").all(),
      before.filter(row => row.name !== "owner_account_security_boundary"));
    assert.throws(() => db.prepare("UPDATE app_meta SET value='{}' WHERE key=?").run(marker), /legacy identity guard/);
    db.exec("BEGIN IMMEDIATE; ROLLBACK");
  } finally { db.close(); }
});

test("guard installation participates in the caller's migration transaction", () => {
  const db = fixture();
  try {
    const before = db.prepare("SELECT sql FROM sqlite_schema WHERE name='owner_identity_no_update'").get().sql;
    db.exec("BEGIN IMMEDIATE");
    ensureOwnerIdentitySchema(db);
    assert.throws(() => db.prepare("UPDATE app_meta SET key='moved' WHERE key=?").run(marker), /Owner identity is locked/);
    db.exec("ROLLBACK");
    assert.equal(db.prepare("SELECT sql FROM sqlite_schema WHERE name='owner_identity_no_update'").get().sql, before);
  } finally { db.close(); }
});
