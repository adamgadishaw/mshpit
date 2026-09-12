import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./integrity-check.mjs", import.meta.url));

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "pit-integrity-shared-email-"));
  const databasePath = join(directory, "pit.db");
  const database = new DatabaseSync(databasePath);
  database.exec(`CREATE TABLE users(
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    handle TEXT NOT NULL,
    genres TEXT,
    favorite_artists TEXT,
    extras TEXT,
    created_at INTEGER,
    email_verified_at INTEGER,
    email_verify_hash TEXT,
    email_verify_expires INTEGER
  )`);
  const insert = database.prepare(`INSERT INTO users(
    id,email,handle,genres,favorite_artists,extras,created_at,email_verified_at,
    email_verify_hash,email_verify_expires
  ) VALUES(?,?,?,?,?,?,?,?,?,?)`);
  return { directory, databasePath, database, insert };
}

function run(databasePath) {
  const result = spawnSync(process.execPath, [SCRIPT, databasePath, "--json"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  return { ...result, report: JSON.parse(result.stdout) };
}

function addUser(insert, id, email) {
  insert.run(id, email, id, "[]", "[]", "{}", Date.now(), Date.now(), null, null);
}

test("integrity audit accepts an intentional shared-email pair and rejects account three", () => {
  const state = fixture();
  try {
    addUser(state.insert, "one", "shared@example.test");
    addUser(state.insert, "two", "SHARED@example.test");
    let result = run(state.databasePath);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.report.ok, true);
    assert.equal(result.report.findings.find((entry) => entry.name === "email account limit exceeded")?.count, 0);

    addUser(state.insert, "three", "shared@example.test");
    result = run(state.databasePath);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.report.ok, false);
    assert.equal(result.report.findings.find((entry) => entry.name === "email account limit exceeded")?.count, 1);
  } finally {
    state.database.close();
    rmSync(state.directory, { recursive: true, force: true });
  }
});
