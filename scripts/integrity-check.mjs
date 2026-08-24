// Read-only data integrity audit.
//
// SQLite enforces the constraints it was given. This checks the ones it was NOT
// given: orphans across tables that were never wired with foreign keys, JSON
// columns that stopped being parseable, duplicate identities that a UNIQUE index
// does not cover, and values that are structurally legal but impossible.
//
//   node scripts/integrity-check.mjs            audit the configured database
//   node scripts/integrity-check.mjs --json      machine-readable output
//
// Never writes. Safe to point at a production snapshot; exits 1 when anything
// fails so it can gate a deploy.
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(String(process.env.PIT_DATA_DIR || "").trim() || join(HERE, "../server/data"));
const DB_PATH = process.argv.find((a) => a.endsWith(".db")) || join(DATA_DIR, "pit.db");
const asJson = process.argv.includes("--json");

if (!existsSync(DB_PATH)) {
  console.error(`No database at ${DB_PATH}. Set PIT_DATA_DIR or pass a path.`);
  process.exit(2);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
const findings = [];
const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));

function check(name, severity, sql, describe) {
  // A check that references a table this database predates is skipped, not
  // failed: the script has to run against older snapshots too.
  const referenced = [...sql.matchAll(/\bFROM\s+([a-z_]+)|\bJOIN\s+([a-z_]+)/gi)].flatMap((m) => [m[1], m[2]]).filter(Boolean);
  const missing = referenced.find((t) => !tables.has(t));
  if (missing) { findings.push({ name, severity: "skipped", count: 0, note: `table ${missing} not in this database` }); return; }
  try {
    const rows = db.prepare(sql).all();
    // Integrity output is routinely copied into deploy logs and support
    // tickets. A count is enough to route remediation; returning row samples
    // can expose email addresses, session-token hashes, and private record
    // identifiers to systems that do not need them.
    findings.push({ name, severity, count: rows.length, note: describe });
  } catch (error) {
    const errorType = String(error?.code || error?.name || "Error").replace(/[^A-Za-z0-9_]/g, "").slice(0, 40) || "Error";
    findings.push({ name, severity: "error", count: 0, note: `check failed (${errorType})` });
  }
}

// --- referential integrity across links SQLite was not told to enforce ---
check("orphan posts", "fail",
  "SELECT p.id FROM posts p LEFT JOIN users u ON u.id = p.user_id WHERE u.id IS NULL LIMIT 20",
  "posts whose author no longer exists");
check("orphan comments", "fail",
  "SELECT c.id FROM comments c LEFT JOIN posts p ON p.id = c.post_id WHERE p.id IS NULL LIMIT 20",
  "comments on a post that no longer exists");
check("orphan likes", "fail",
  "SELECT l.post_id FROM likes l LEFT JOIN posts p ON p.id = l.post_id WHERE p.id IS NULL LIMIT 20",
  "likes pointing at a deleted post");
check("orphan sessions", "warn",
  "SELECT s.token_hash FROM sessions s LEFT JOIN users u ON u.id = s.user_id WHERE u.id IS NULL LIMIT 20",
  "sessions for a deleted account; they should have been cascaded");
check("comment reply to a missing parent", "warn",
  "SELECT c.id FROM comments c WHERE c.parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM comments p WHERE p.id = c.parent_id) LIMIT 20",
  "threaded replies whose parent is gone");
check("orphan badge grants", "fail",
  "SELECT ub.user_id FROM user_badges ub LEFT JOIN custom_badges b ON b.id = ub.badge_id WHERE b.id IS NULL LIMIT 20",
  "granted badges whose definition was deleted rather than archived");

// --- identity uniqueness that no index guarantees ---
check("duplicate emails", "fail",
  "SELECT LOWER(email) e, COUNT(*) c FROM users GROUP BY LOWER(email) HAVING c > 1 LIMIT 20",
  "two accounts share an address, case-insensitively");
check("duplicate handles", "fail",
  "SELECT LOWER(handle) h, COUNT(*) c FROM users GROUP BY LOWER(handle) HAVING c > 1 LIMIT 20",
  "two accounts share a handle, case-insensitively");
check("duplicate badge slugs", "fail",
  "SELECT LOWER(slug) s, COUNT(*) c FROM custom_badges GROUP BY LOWER(slug) HAVING c > 1 LIMIT 20",
  "badge slugs must be unique; they are identity");

// --- JSON columns that must still parse (the feed builds from these) ---
for (const [table, column] of [["posts", "photos"], ["posts", "setlist"], ["posts", "tags"], ["posts", "dims"], ["users", "genres"], ["users", "favorite_artists"], ["users", "extras"]]) {
  check(`unparseable ${table}.${column}`, "warn",
    `SELECT rowid FROM ${table} WHERE ${column} IS NOT NULL AND ${column} <> '' AND json_valid(${column}) = 0 LIMIT 20`,
    "stored JSON no longer parses; projections degrade it to empty");
}

// --- values that are structurally legal but impossible ---
check("ratings out of range", "fail",
  "SELECT id, overall, band, room FROM posts WHERE overall NOT BETWEEN 0 AND 5 OR band NOT BETWEEN 0 AND 5 OR room NOT BETWEEN 0 AND 5 LIMIT 20",
  "a score outside 0-5");
check("posts dated in the future", "warn",
  `SELECT id, date FROM posts WHERE date > date('now', '+2 day') LIMIT 20`,
  "a logged show in the future; reviews are for nights that happened");
check("users created in the future", "warn",
  "SELECT id FROM users WHERE created_at > (strftime('%s','now') * 1000) + 86400000 LIMIT 20",
  "a creation timestamp ahead of now, which breaks cursor ordering");
check("verified email without a timestamp", "warn",
  "SELECT id FROM users WHERE email_verified_at < 0 LIMIT 20",
  "negative verification timestamps");
check("live verification tokens that already expired", "warn",
  "SELECT id FROM users WHERE email_verify_hash IS NOT NULL AND email_verify_expires < (strftime('%s','now') * 1000) LIMIT 20",
  "spent tokens left behind; harmless but they should be cleared on use");
check("campaign counted beyond its own queue", "fail",
  `SELECT c.id, c.sent_count, (SELECT COUNT(*) FROM email_queue q WHERE q.campaign_id = c.id) queued
   FROM email_campaigns c WHERE c.sent_count > (SELECT COUNT(*) FROM email_queue q WHERE q.campaign_id = c.id) LIMIT 20`,
  "a campaign reports more sent than it ever queued");
check("device-local media URLs persisted", "fail",
  `SELECT id FROM posts WHERE photos LIKE '%"file:%' OR photos LIKE '%"blob:%' LIMIT 20`,
  "a file:/blob: URI was saved instead of an uploaded object URL");

db.close();

// --- report ---
const failed = findings.filter((f) => f.severity === "fail" && f.count > 0);
const warned = findings.filter((f) => f.severity === "warn" && f.count > 0);
const broken = findings.filter((f) => f.severity === "error");

if (asJson) {
  console.log(JSON.stringify({ database: DB_PATH, findings, ok: failed.length === 0 && broken.length === 0 }, null, 2));
} else {
  console.log(`integrity check  ${DB_PATH}\n`);
  for (const f of findings) {
    const mark = f.severity === "skipped" ? "-" : f.count === 0 ? "ok" : f.severity === "warn" ? "warn" : f.severity === "error" ? "ERR" : "FAIL";
    console.log(`  ${mark.padEnd(5)} ${f.name}${f.count ? `  (${f.count})` : ""}${f.severity !== "skipped" && f.count ? `\n        ${f.note}` : ""}`);
  }
  console.log(`\n  ${failed.length} failing, ${warned.length} warnings, ${broken.length} checks errored`);
}

process.exit(failed.length || broken.length ? 1 : 0);
