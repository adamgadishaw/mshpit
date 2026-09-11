import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./audit-userbase.mjs", import.meta.url));
const DAY = 86_400_000;

// A deliberately partial schema: the audit must skip what an older snapshot
// lacks, and every planted identifying value must stay out of its output.
function fixtureDatabase(dir) {
  const path = join(dir, "pit.db");
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL, handle TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'fan', home_city TEXT, extras TEXT NOT NULL DEFAULT '{}',
      email_verified_at INTEGER, created_at INTEGER NOT NULL);
    CREATE TABLE posts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, artist TEXT NOT NULL, venue TEXT NOT NULL,
      review TEXT NOT NULL DEFAULT '', kind TEXT, artist_key TEXT, venue_key TEXT,
      removed INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL, ip TEXT, ua TEXT);
    CREATE TABLE tour_dates (id TEXT PRIMARY KEY, artist TEXT, venue TEXT, date TEXT, event_name TEXT,
      provider_active INTEGER, music_qualified INTEGER, event_kind TEXT);
  `);
  const now = Date.now();
  const user = db.prepare("INSERT INTO users (id,email,name,handle,home_city,extras,email_verified_at,created_at) VALUES (?,?,?,?,?,?,?,?)");
  user.run("u_private_one", "secret.person@gmail.com", "Private Person", "privatehandle", "Hometown Secret", "{}", now - 40 * DAY, now - 40 * DAY);
  user.run("u_private_two", "second.person@proton.me", "Second Person", "secondhandle", "Hometown Secret", "not json", null, now - 20 * DAY);
  user.run("u_fixture", "fixture@example.test", "Fixture Account", "fixtureaccount", null, "{}", now, now - 10 * DAY);
  const post = db.prepare("INSERT INTO posts (id,user_id,artist,venue,review,kind,artist_key,venue_key,created_at) VALUES (?,?,?,?,?,?,?,?,?)");
  post.run("p_private_one", "u_private_one", "Hidden Band", "Hidden Hall", "my private review text", "review", "", "", now - 39 * DAY);
  post.run("p_private_two", "u_private_one", "Hidden Band", "Hidden Hall", "another private review", "review", "hidden band", "hidden hall", now - 2 * DAY);
  post.run("p_fixture", "u_fixture", "Hidden Band", "Hidden Hall", "seeded status", "status", "hidden band", "hidden hall", now - 9 * DAY);
  db.prepare("INSERT INTO sessions VALUES (?,?,?,?,?,?)").run("h_private", "u_private_two", now - DAY, now + DAY, "203.0.113.9", "Secret Browser/1.0");
  const event = db.prepare("INSERT INTO tour_dates (id,artist,venue,date,event_name,provider_active,music_qualified,event_kind) VALUES (?,?,?,?,?,?,?,?)");
  event.run("t_live", "Hidden Band", "Hidden Hall", "2999-01-01", "Hidden Band Live", 1, 1, "concert");
  event.run("t_addon", "Hidden Band", "Hidden Hall", "2000-01-01", "Hidden Band Souvenir Ticket", 1, 1, "concert");
  db.close();
  return path;
}

const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const audit = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });

test("the user-base audit reports aggregates, skips missing tables, and never prints row content", () => {
  const dir = mkdtempSync(join(tmpdir(), "pit-audit-userbase-"));
  try {
    const path = fixtureDatabase(dir);
    const before = digest(path);
    const result = audit("--db", path);
    assert.equal(result.status, 0, result.stderr);
    const out = result.stdout;
    assert.match(out, /\naccounts\s+3\n/);
    assert.match(out, /real-looking accounts \(used below\)\s+2\n/);
    assert.match(out, /posts \(not removed\)\s+2 by 1 people \(50\.0% of accounts\)/);
    assert.match(out, /live posts from test or example accounts\s+1 of 3/);
    assert.match(out, /accounts in the most common home city\s+2 \(100\.0% of those with a city; name not printed\)/);
    assert.match(out, /opted out of product analytics\s+0 \(0\.0%\)/, "a malformed extras value is skipped, not fatal");
    assert.match(out, /names that look like ticket add-ons\s+1 \(50\.0%\)/);
    assert.match(out, /sessions storing a raw IP\s+1\n/);
    assert.match(out, /posts linked to a canonical show\s+not possible/);
    assert.doesNotMatch(out, /comments \(not removed\)/, "a table the snapshot lacks is skipped");
    for (const secret of [
      "secret.person", "second.person", "Private Person", "privatehandle", "Hometown Secret",
      "private review", "Hidden Band", "Hidden Hall", "203.0.113.9", "Secret Browser",
      "u_private_one", "p_private_one", "h_private",
    ]) {
      assert.equal(out.includes(secret), false, `output must not contain ${secret}`);
    }
    assert.equal(digest(path), before, "the audit opens the database read-only");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the user-base audit refuses a database path that does not exist", () => {
  const result = audit("--db", join(tmpdir(), "pit-audit-userbase-missing", "pit.db"));
  assert.equal(result.status, 2);
  assert.match(result.stderr, /No database at/);
  assert.equal(result.stdout, "");
});
