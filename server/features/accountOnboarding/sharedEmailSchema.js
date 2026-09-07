const quote = (name) => '"' + name.replaceAll('"', '""') + '"';

// SQLite's documented create/copy/drop/rename migration. Never rename the old
// parent first: that rewrites child foreign keys to the temporary table name.
export function ensureSharedEmailSchema(database) {
  const installed = database.prepare(`SELECT COUNT(*) n FROM sqlite_schema WHERE name IN
    ('idx_users_email_accounts','idx_users_signup_cancel','trg_users_email_capacity_insert','trg_users_email_capacity_update')`).get().n;
  if (installed === 4) return;
  const foreignKeys = database.prepare("PRAGMA foreign_keys").get().foreign_keys;
  database.exec("PRAGMA foreign_keys=OFF");
  if (database.prepare("PRAGMA foreign_keys").get().foreign_keys) throw new Error("Shared-email migration must run outside a transaction");
  let transactionStarted = false;
  try {
    database.exec("BEGIN IMMEDIATE");
    transactionStarted = true;
    const schema = database.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name='users'").get()?.sql;
    if (!schema) throw new Error("Users table is missing; refusing shared-email migration");
    if (/email\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(schema)) {
      const objects = database.prepare("SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND (type IN ('view','trigger') OR (type='index' AND tbl_name='users'))").all();
      const columns = database.prepare("PRAGMA table_info(users)").all().map((row) => quote(row.name)).join(",");
      const before = database.prepare("SELECT COUNT(*) n FROM users").get().n;
      const revised = schema.replace(/^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["`\[]?users["`\]]?/i, "CREATE TABLE users_shared_email_migration")
        .replace(/email\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i, "email TEXT NOT NULL");
      if (revised === schema) throw new Error("Unsupported users schema; refusing migration");
      for (const row of objects) if (row.type !== "index") database.exec(`DROP ${row.type} ${quote(row.name)}`);
      database.exec(revised);
      database.exec(`INSERT INTO users_shared_email_migration (${columns}) SELECT ${columns} FROM users`);
      if (database.prepare("SELECT COUNT(*) n FROM users_shared_email_migration").get().n !== before) throw new Error("Account migration count mismatch");
      database.exec("DROP TABLE users; ALTER TABLE users_shared_email_migration RENAME TO users");
      for (const row of objects) database.exec(row.sql);
    }
    if (database.prepare("SELECT 1 FROM users GROUP BY lower(trim(email)) HAVING COUNT(*)>2 LIMIT 1").get()) {
      throw new Error("More than two accounts already share an email; manual review required");
    }
    if (!database.prepare("PRAGMA table_info(users)").all().some((row) => row.name === "signup_cancel_hash")) {
      database.exec("ALTER TABLE users ADD COLUMN signup_cancel_hash TEXT");
    }
    database.exec(`CREATE INDEX IF NOT EXISTS idx_users_email_accounts ON users(lower(trim(email)),created_at,id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_signup_cancel ON users(signup_cancel_hash) WHERE signup_cancel_hash IS NOT NULL;
      CREATE TRIGGER IF NOT EXISTS trg_users_email_capacity_insert BEFORE INSERT ON users
      WHEN (SELECT COUNT(*) FROM users WHERE lower(trim(email))=lower(trim(NEW.email)))>=2
      BEGIN SELECT RAISE(ABORT,'EMAIL_ACCOUNT_LIMIT'); END;
      CREATE TRIGGER IF NOT EXISTS trg_users_email_capacity_update BEFORE UPDATE OF email ON users
      WHEN (SELECT COUNT(*) FROM users WHERE lower(trim(email))=lower(trim(NEW.email)) AND id<>OLD.id)>=2
      BEGIN SELECT RAISE(ABORT,'EMAIL_ACCOUNT_LIMIT'); END;`);
    if (database.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Account migration foreign-key check failed");
    database.exec("COMMIT");
  } catch (error) {
    if (transactionStarted) database.exec("ROLLBACK");
    throw error;
  } finally {
    database.exec(`PRAGMA foreign_keys=${foreignKeys ? "ON" : "OFF"}`);
  }
}
