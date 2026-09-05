import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { PIT_SQLITE_APPLICATION_ID, assertExistingProductionDatabase, prepareDataDirectory } from "./dataDirectory.js";

function createInitializedDatabase(path) {
  const database = new DatabaseSync(path);
  database.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE posts (id TEXT PRIMARY KEY);
    CREATE TABLE artists (id TEXT PRIMARY KEY);
    CREATE TABLE tour_dates (id TEXT PRIMARY KEY);
    CREATE TABLE schema_version (version INTEGER NOT NULL);
    CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO schema_version VALUES (1);
    INSERT INTO users VALUES ('u_live');
    INSERT INTO posts VALUES ('p_live');
    INSERT INTO artists VALUES ('a_live');
  `);
  database.close();
}

test("production refuses an implicit database directory", () => {
  assert.throws(
    () => prepareDataDirectory({ env: { NODE_ENV: "production" }, fallbackDir: "fallback", exists: () => true }),
    /PIT_DATA_DIR is required/,
  );
});

test("production refuses an unmounted disk without creating a fallback", () => {
  let mkdirCalls = 0;
  assert.throws(
    () => prepareDataDirectory({
      env: { NODE_ENV: "production", PIT_DATA_DIR: "missing-mount" },
      fallbackDir: "fallback-must-not-be-used",
      exists: () => false,
      mkdir: () => { mkdirCalls += 1; },
    }),
    /does not exist.*persistent disk mount/i,
  );
  assert.equal(mkdirCalls, 0, "production must not create either the configured path or a local fallback");
});

test("production accepts an existing database and development creates its fallback", () => {
  const mounted = mkdtempSync(join(tmpdir(), "pit-mounted-"));
  createInitializedDatabase(join(mounted, "pit.db"));
  let made = null;
  try {
    const production = prepareDataDirectory({
      env: { NODE_ENV: "production", PIT_DATA_DIR: mounted },
      mkdir: () => { throw new Error("production must not create its mount"); },
    });
    assert.equal(production, resolve(mounted));
    const development = prepareDataDirectory({
      env: {},
      fallbackDir: "development-data",
      mkdir: (path) => { made = path; },
    });
    assert.equal(development, made);
  } finally {
    rmSync(mounted, { recursive: true, force: true });
  }
});

test("production refuses an existing but uninitialized directory unless bootstrap is explicit", () => {
  const mounted = mkdtempSync(join(tmpdir(), "pit-empty-mounted-"));
  try {
    assert.throws(
      () => prepareDataDirectory({
        env: { NODE_ENV: "production", PIT_DATA_DIR: mounted },
      }),
      /production database is missing/i,
    );
    assert.equal(prepareDataDirectory({
      env: {
        NODE_ENV: "production",
        PIT_DATA_DIR: mounted,
        PIT_ALLOW_EMPTY_DB_BOOTSTRAP: "true",
      },
    }), resolve(mounted));
  } finally {
    rmSync(mounted, { recursive: true, force: true });
  }
});

test("bootstrap approval never creates an absent production mount", () => {
  const parent = mkdtempSync(join(tmpdir(), "pit-absent-mounted-"));
  const absent = join(parent, "data");
  try {
    assert.throws(
      () => prepareDataDirectory({
        env: {
          NODE_ENV: "production",
          PIT_DATA_DIR: absent,
          PIT_ALLOW_EMPTY_DB_BOOTSTRAP: "true",
        },
      }),
      /does not exist.*persistent disk mount/i,
    );
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("production refuses zero-byte and unrelated database files before migrations", () => {
  const mounted = mkdtempSync(join(tmpdir(), "pit-invalid-mounted-"));
  try {
    const databasePath = join(mounted, "pit.db");
    writeFileSync(databasePath, "");
    assert.throws(
      () => prepareDataDirectory({
        env: { NODE_ENV: "production", PIT_DATA_DIR: mounted },
      }),
      /not an initialized Pit database.*refusing to migrate/i,
    );

    rmSync(databasePath, { force: true });
    const unrelated = new DatabaseSync(databasePath);
    unrelated.exec("CREATE TABLE unrelated (id TEXT PRIMARY KEY)");
    unrelated.close();
    assert.throws(
      () => assertExistingProductionDatabase(databasePath),
      /not an initialized Pit database.*refusing to migrate/i,
    );
  } finally {
    rmSync(mounted, { recursive: true, force: true });
  }
});

test("production refuses a structurally valid but empty Pit database", () => {
  const mounted = mkdtempSync(join(tmpdir(), "pit-empty-schema-mounted-"));
  const databasePath = join(mounted, "pit.db");
  const database = new DatabaseSync(databasePath);
  database.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE posts (id TEXT PRIMARY KEY);
    CREATE TABLE artists (id TEXT PRIMARY KEY);
    CREATE TABLE tour_dates (id TEXT PRIMARY KEY);
    CREATE TABLE schema_version (version INTEGER NOT NULL);
    CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO schema_version VALUES (1);
  `);
  database.close();
  try {
    assert.throws(
      () => prepareDataDirectory({ env: { NODE_ENV: "production", PIT_DATA_DIR: mounted } }),
      /not an initialized Pit database.*refusing to migrate/i,
    );
  } finally {
    rmSync(mounted, { recursive: true, force: true });
  }
});

test("a marked initialized Pit database can legitimately have no posts", () => {
  const mounted = mkdtempSync(join(tmpdir(), "pit-marked-mounted-"));
  const databasePath = join(mounted, "pit.db");
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA application_id = ${PIT_SQLITE_APPLICATION_ID};
    CREATE TABLE schema_version (version INTEGER NOT NULL);
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE posts (id TEXT PRIMARY KEY);
    CREATE TABLE artists (id TEXT PRIMARY KEY);
    CREATE TABLE tour_dates (id TEXT PRIMARY KEY);
    CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO schema_version VALUES (1);
    INSERT INTO users VALUES ('u_admin');
    INSERT INTO artists VALUES ('a_seeded');
  `);
  database.close();
  try {
    assert.equal(
      prepareDataDirectory({ env: { NODE_ENV: "production", PIT_DATA_DIR: mounted } }),
      resolve(mounted),
    );
  } finally {
    rmSync(mounted, { recursive: true, force: true });
  }
});

test("production refuses a different SQLite application identity", () => {
  const mounted = mkdtempSync(join(tmpdir(), "pit-wrong-identity-"));
  const databasePath = join(mounted, "pit.db");
  createInitializedDatabase(databasePath);
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA application_id = 123456");
  database.close();
  try {
    assert.throws(
      () => prepareDataDirectory({ env: { NODE_ENV: "production", PIT_DATA_DIR: mounted } }),
      /not an initialized Pit database.*refusing to migrate/i,
    );
  } finally {
    rmSync(mounted, { recursive: true, force: true });
  }
});

test("production refuses a database missing its durable event and venue catalogue", () => {
  const mounted = mkdtempSync(join(tmpdir(), "pit-missing-tour-catalogue-"));
  const databasePath = join(mounted, "pit.db");
  createInitializedDatabase(databasePath);
  const database = new DatabaseSync(databasePath);
  database.exec("DROP TABLE tour_dates");
  database.close();
  try {
    assert.throws(
      () => prepareDataDirectory({ env: { NODE_ENV: "production", PIT_DATA_DIR: mounted } }),
      /not an initialized Pit database.*refusing to migrate/i,
    );
  } finally {
    rmSync(mounted, { recursive: true, force: true });
  }
});

test("explicit first-boot approval is the only bypass for an uninitialized database file", () => {
  const mounted = mkdtempSync(join(tmpdir(), "pit-explicit-bootstrap-"));
  const databasePath = join(mounted, "pit.db");
  writeFileSync(databasePath, "");
  let validations = 0;
  try {
    assert.equal(prepareDataDirectory({
      env: {
        NODE_ENV: "production",
        PIT_DATA_DIR: mounted,
        PIT_ALLOW_EMPTY_DB_BOOTSTRAP: "true",
      },
      validateDatabase: () => { validations += 1; },
    }), resolve(mounted));
    assert.equal(validations, 0, "the one-time bootstrap flag deliberately bypasses the existing-file preflight");
  } finally {
    rmSync(mounted, { recursive: true, force: true });
  }
});

test("production db import fails before a zero-byte file can be migrated", () => {
  const mounted = mkdtempSync(join(tmpdir(), "pit-production-preflight-e2e-"));
  const databasePath = join(mounted, "pit.db");
  writeFileSync(databasePath, "");
  try {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", "await import('./server/db.js')"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_ENV: "production",
        PIT_DATA_DIR: mounted,
        PIT_ALLOW_EMPTY_DB_BOOTSTRAP: "false",
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not an initialized Pit database.*refusing to migrate/i);
    assert.equal(statSync(databasePath).size, 0, "the failed startup must not lay down Pit schema pages");
  } finally {
    rmSync(mounted, { recursive: true, force: true });
  }
});
