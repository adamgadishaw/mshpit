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
import { registerPitSqliteFunctions } from "../server/sqliteFunctions.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(String(process.env.PIT_DATA_DIR || "").trim() || join(HERE, "../server/data"));
const DB_PATH = process.argv.find((a) => a.endsWith(".db")) || join(DATA_DIR, "pit.db");
const asJson = process.argv.includes("--json");

if (!existsSync(DB_PATH)) {
  console.error(`No database at ${DB_PATH}. Set PIT_DATA_DIR or pass a path.`);
  process.exit(2);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
registerPitSqliteFunctions(db);
// All checks must describe one committed snapshot. Without a read transaction,
// concurrent conversion/deletion can look like a broken relationship between
// otherwise individually valid queries. This never takes a writer lock.
db.exec("BEGIN");
const findings = [];
const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
const auditVirtualTables = new Set(["pragma_foreign_key_check", "pragma_quick_check"]);
const columnsByTable = new Map();

function check(name, severity, sql, describe, requiredColumns = []) {
  // A check that references a table this database predates is skipped, not
  // failed: the script has to run against older snapshots too.
  const referenced = [...sql.matchAll(/\bFROM\s+([a-z_]+)|\bJOIN\s+([a-z_]+)/gi)].flatMap((m) => [m[1], m[2]]).filter(Boolean);
  const missing = referenced.find((t) => !tables.has(t) && !auditVirtualTables.has(t));
  if (missing) { findings.push({ name, severity: "skipped", count: 0, note: `table ${missing} not in this database` }); return; }
  for (const [table, column] of requiredColumns) {
    if (!columnsByTable.has(table)) columnsByTable.set(table, new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name)));
    if (!columnsByTable.get(table).has(column)) {
      findings.push({ name, severity: "skipped", count: 0, note: `column ${table}.${column} not in this database` });
      return;
    }
  }
  try {
    // One look-ahead row distinguishes an exact 20 from a truncated finding.
    // Counts stay bounded and no individual record is emitted.
    const bounded = /\bLIMIT\s+20\s*$/i.test(sql);
    const rows = db.prepare(bounded ? sql.replace(/\bLIMIT\s+20\s*$/i, "LIMIT 21") : sql).all();
    // Integrity output is routinely copied into deploy logs and support
    // tickets. A count is enough to route remediation; returning row samples
    // can expose email addresses, session-token hashes, and private record
    // identifiers to systems that do not need them.
    findings.push({ name, severity, count: bounded ? Math.min(rows.length, 20) : rows.length,
      countCapped: bounded && rows.length > 20, note: describe });
  } catch (error) {
    const errorType = String(error?.code || error?.name || "Error").replace(/[^A-Za-z0-9_]/g, "").slice(0, 40) || "Error";
    findings.push({ name, severity: "error", count: 0, note: `check failed (${errorType})` });
  }
}

// Cover every declared FK, including future feature tables, not just the
// historical relations named below. The application functions are registered
// above so SQLite can parse expression indexes on this read-only connection.
check("SQLite foreign key violations", "fail",
  "SELECT * FROM pragma_foreign_key_check LIMIT 20",
  "declared foreign-key relationships are broken");
check("SQLite structural integrity", "fail",
  "SELECT quick_check FROM pragma_quick_check WHERE quick_check <> 'ok' LIMIT 20",
  "SQLite detected structural, type, or CHECK-constraint corruption");

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
check("orphan comment authors", "fail",
  "SELECT c.id FROM comments c LEFT JOIN users u ON u.id=c.user_id WHERE u.id IS NULL LIMIT 20",
  "comments whose author no longer exists");
check("orphan like owners", "fail",
  "SELECT l.post_id FROM likes l LEFT JOIN users u ON u.id=l.user_id WHERE u.id IS NULL LIMIT 20",
  "likes whose account no longer exists");
check("orphan follow endpoints", "fail",
  `SELECT f.follower_id FROM follows f LEFT JOIN users a ON a.id=f.follower_id
   LEFT JOIN users b ON b.id=f.followee_id WHERE a.id IS NULL OR b.id IS NULL LIMIT 20`,
  "follow relationships with a missing follower or target");
check("orphan notification endpoints", "fail",
  `SELECT n.id FROM notifications n LEFT JOIN users recipient ON recipient.id=n.user_id
   LEFT JOIN users actor ON actor.id=n.actor_id
   WHERE recipient.id IS NULL OR (n.actor_id IS NOT NULL AND actor.id IS NULL) LIMIT 20`,
  "notifications with a missing recipient or non-null actor");
check("comment reply belongs to another post", "fail",
  `SELECT c.id FROM comments c JOIN comments parent ON parent.id=c.parent_id
   WHERE parent.post_id<>c.post_id LIMIT 20`,
  "comment reply parents must belong to the same post");
check("post tag author mismatch", "fail",
  `SELECT t.post_id FROM post_user_tags t JOIN posts p ON p.id=t.post_id
   WHERE t.author_id<>p.user_id LIMIT 20`,
  "structured tags must be owned by the actual post author");
check("post media ownership mismatch", "fail",
  `SELECT m.post_id FROM post_media m JOIN posts p ON p.id=m.post_id
   JOIN media_assets a ON a.id=m.asset_id WHERE p.user_id<>a.owner_id LIMIT 20`,
  "a post references another account's stable media asset");
check("media source ledger ownership mismatch", "fail",
  `SELECT a.id FROM media_assets a JOIN media_objects o ON o.object_key=a.source_key
   WHERE a.owner_id<>o.owner_id LIMIT 20`,
  "a media source capability belongs to a different account");
check("media variant ledger ownership mismatch", "fail",
  `SELECT v.id FROM media_variants v JOIN media_assets a ON a.id=v.asset_id
   JOIN media_objects o ON o.object_key=v.object_key WHERE a.owner_id<>o.owner_id LIMIT 20`,
  "a media rendition capability belongs to a different account");
check("media processing job ownership mismatch", "fail",
  `SELECT j.asset_id FROM media_processing_jobs j JOIN media_assets a ON a.id=j.asset_id
   WHERE j.owner_id<>a.owner_id LIMIT 20`,
  "a durable conversion job belongs to someone other than its asset owner");
check("non-video asset in video processing queue", "fail",
  `SELECT j.asset_id FROM media_processing_jobs j JOIN media_assets a ON a.id=j.asset_id
   WHERE a.kind<>'video' LIMIT 20`,
  "the video queue contains an asset it cannot safely process",
  [["media_assets", "kind"]]);
check("invalid media processing request", "fail",
  `SELECT asset_id FROM media_processing_jobs
   WHERE CASE WHEN json_valid(body) THEN json_type(body)<>'object' ELSE 1 END LIMIT 20`,
  "a durable conversion request is not a JSON object");
check("unscheduled media processing retry", "fail",
  `SELECT asset_id FROM media_processing_jobs
   WHERE state='retry' AND next_attempt_at IS NULL LIMIT 20`,
  "a pending conversion cannot resume without a retry deadline");
for (const role of ["render", "poster"]) {
  check(`invalid media ${role} variant reference`, "fail",
    `SELECT a.id FROM media_assets a LEFT JOIN media_variants v ON v.id=a.${role}_variant_id
     WHERE a.${role}_variant_id IS NOT NULL AND (v.id IS NULL OR v.asset_id<>a.id OR v.role<>'${role}') LIMIT 20`,
    "the active rendition is missing, belongs to another asset, or has the wrong role",
    [["media_assets", `${role}_variant_id`], ["media_variants", "role"]]);
}
check("media revision ledger ownership mismatch", "fail",
  `SELECT r.asset_id FROM media_asset_revisions r JOIN media_assets a ON a.id=r.asset_id
   JOIN media_objects o ON o.object_key=r.object_key WHERE a.owner_id<>o.owner_id LIMIT 20`,
  "an unfinished photo edit references another account's storage capability");
check("linked grant session owner mismatch", "fail",
  `SELECT g.token_hash FROM linked_account_session_grants g JOIN sessions s ON s.token_hash=g.token_hash
   WHERE s.user_id NOT IN (g.user_a_id,g.user_b_id) LIMIT 20`,
  "a linked-account grant is attached to a session outside its authorized pair");
check("linked grant exceeds session expiry", "fail",
  `SELECT g.token_hash FROM linked_account_session_grants g JOIN sessions s ON s.token_hash=g.token_hash
   WHERE g.expires_at>s.expires_at LIMIT 20`,
  "a linked-account grant outlives the session that authorized it",
  [["linked_account_session_grants", "expires_at"], ["sessions", "expires_at"]]);
check("linked pair email mismatch", "fail",
  `SELECT p.user_a_id FROM linked_account_pairs p JOIN users a ON a.id=p.user_a_id
   JOIN users b ON b.id=p.user_b_id WHERE lower(trim(a.email))<>lower(trim(b.email)) LIMIT 20`,
  "linked identities no longer share their normalized email address");

// --- identity uniqueness that no index guarantees ---
check("email account limit exceeded", "fail",
  "SELECT lower(trim(email)) e, COUNT(*) c FROM users GROUP BY lower(trim(email)) HAVING c > 2 LIMIT 20",
  "more than two accounts share an address after case and surrounding-whitespace normalization");
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

db.exec("COMMIT");
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
    const mark = f.severity === "skipped" ? "-" : f.severity === "error" ? "ERR" : f.count === 0 ? "ok" : f.severity === "warn" ? "warn" : "FAIL";
    const showNote = f.severity === "error" || (f.severity !== "skipped" && f.count > 0);
    console.log(`  ${mark.padEnd(5)} ${f.name}${f.count ? `  (${f.count}${f.countCapped ? "+; capped" : ""})` : ""}${showNote ? `\n        ${f.note}` : ""}`);
  }
  console.log(`\n  ${failed.length} failing, ${warned.length} warnings, ${broken.length} checks errored`);
}

process.exit(failed.length || broken.length ? 1 : 0);
