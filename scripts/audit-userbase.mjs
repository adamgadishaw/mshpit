#!/usr/bin/env node
// Read-only, aggregate-only audit of the Pit database: who the user base is,
// what they actually do, and how the stored data is shaped. SQLite is opened in
// read-only mode and only counts, shares, and sizes are printed. No email, name,
// handle, id, message, review, city, or other row content is ever printed, so the
// output is safe to paste into an issue or a chat.
//
//   npm run audit:userbase                          uses $PIT_DATA_DIR/pit.db
//   node scripts/audit-userbase.mjs --db ./pit.db   any snapshot
import { DatabaseSync } from "node:sqlite";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const args = process.argv.slice(2);
const dbFlag = args.indexOf("--db");
const dataDir = resolve(String(process.env.PIT_DATA_DIR || "").trim() || "server/data");
const path = resolve(dbFlag !== -1 && args[dbFlag + 1] ? args[dbFlag + 1] : join(dataDir, "pit.db"));
if (!existsSync(path)) {
  console.error(`No database at ${path}`);
  process.exit(2);
}

const db = new DatabaseSync(path, { readOnly: true });
const NOW = Date.now();
const DAY = 86_400_000;
const TODAY = new Date(NOW).toISOString().slice(0, 10);

// Every query below is guarded by these checks instead of a catch, so an older
// snapshot skips what it does not have and a real error still stops the audit.
const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
const columnCache = new Map();
function columns(table) {
  if (!columnCache.has(table)) {
    columnCache.set(table, tables.has(table)
      ? new Set(db.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name))
      : new Set());
  }
  return columnCache.get(table);
}
const has = (table, ...cols) => tables.has(table) && cols.every((c) => columns(table).has(c));
const rows = (sql, ...params) => db.prepare(sql).all(...params);
const value = (sql, ...params) => {
  const row = db.prepare(sql).get(...params);
  return row ? Number(Object.values(row)[0] ?? 0) : 0;
};
const pct = (part, whole) => (whole ? `${((100 * part) / whole).toFixed(1)}%` : "-");
const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;
const section = (title) => console.log(`\n== ${title} ==`);
const line = (label, text) => console.log(`${String(label).padEnd(46)} ${text}`);

console.log(`Pit database audit, generated ${new Date(NOW).toISOString()}`);
console.log("Aggregate counts only. No emails, names, handles, ids, cities, or content are printed.");

// ------------------------------------------------------------------ storage
section("Storage");
line("database file", mb(statSync(path).size));
if (existsSync(`${path}-wal`)) line("write-ahead log", mb(statSync(`${path}-wal`).size));
const pageCount = value("PRAGMA page_count");
const freePages = value("PRAGMA freelist_count");
line("free pages (reclaimable by VACUUM)", `${freePages} of ${pageCount} (${pct(freePages, pageCount)})`);
line("tables", tables.size);
if (value("SELECT COUNT(*) FROM pragma_compile_options WHERE compile_options='ENABLE_DBSTAT_VTAB'") > 0) {
  for (const r of rows("SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name ORDER BY bytes DESC LIMIT 12")) {
    line(`  ${r.name}`, mb(r.bytes));
  }
}
const backupDir = join(dirname(path), "backups");
if (existsSync(backupDir)) {
  const snapshots = readdirSync(backupDir).filter((f) => f.endsWith(".db"));
  const total = snapshots.reduce((sum, f) => sum + statSync(join(backupDir, f)).size, 0);
  line("local backup snapshots", `${snapshots.length} files, ${mb(total)}`);
}

// ------------------------------------------------------------------ accounts
section("Accounts");
const TEST = "(lower(email) LIKE '%@example.%' OR lower(email) LIKE '%.test' OR lower(email) LIKE '%.invalid' OR lower(email) LIKE '%@localhost' OR lower(email) LIKE '%.local')";
const REAL = `NOT ${TEST}`;
const accounts = value("SELECT COUNT(*) FROM users");
const testAccounts = value(`SELECT COUNT(*) FROM users WHERE ${TEST}`);
const real = accounts - testAccounts;
line("accounts", accounts);
line("  on test or example email domains", testAccounts);
line("  real-looking accounts (used below)", real);
if (has("users", "role")) {
  for (const r of rows(`SELECT role, COUNT(*) c FROM users WHERE ${REAL} GROUP BY role ORDER BY c DESC`)) line(`  role: ${r.role}`, r.c);
}
if (has("users", "email_verified_at")) {
  const verified = value(`SELECT COUNT(*) FROM users WHERE ${REAL} AND email_verified_at IS NOT NULL`);
  line("  email verified", `${verified} (${pct(verified, real)})`);
}
if (has("users", "onboarding_version")) {
  const onboarded = value(`SELECT COUNT(*) FROM users WHERE ${REAL} AND onboarding_version IS NOT NULL`);
  line("  finished signup onboarding", `${onboarded} (${pct(onboarded, real)})`);
}
if (has("users", "is_banned")) line("  banned", value(`SELECT COUNT(*) FROM users WHERE ${REAL} AND is_banned=1`));
if (has("users", "suspended_until")) line("  suspended now", value(`SELECT COUNT(*) FROM users WHERE ${REAL} AND suspended_until > ?`, NOW));
for (const col of ["age_band", "profile_audience", "dm_policy"]) {
  if (!has("users", col)) continue;
  const parts = rows(`SELECT ${col} AS k, COUNT(*) c FROM users WHERE ${REAL} GROUP BY ${col} ORDER BY c DESC`);
  line(`  ${col}`, parts.map((p) => `${p.k}=${p.c}`).join("  "));
}
if (has("users", "home_city")) {
  const CITY = "trim(coalesce(home_city,'')) <> ''";
  const withCity = value(`SELECT COUNT(*) FROM users WHERE ${REAL} AND ${CITY}`);
  const cities = value(`SELECT COUNT(DISTINCT lower(trim(home_city))) FROM users WHERE ${REAL} AND ${CITY}`);
  const topCity = value(`SELECT COUNT(*) c FROM users WHERE ${REAL} AND ${CITY} GROUP BY lower(trim(home_city)) ORDER BY c DESC LIMIT 1`);
  line("  set a home city", `${withCity} (${pct(withCity, real)}), ${cities} distinct`);
  line("  accounts in the most common home city", `${topCity} (${pct(topCity, withCity)} of those with a city; name not printed)`);
}
if (has("users", "extras")) {
  const optOut = value(`SELECT COUNT(*) FROM users WHERE ${REAL} AND (CASE WHEN json_valid(extras) THEN json_extract(extras,'$.analyticsOptOut') END) IN (1,'true')`);
  line("  opted out of product analytics", `${optOut} (${pct(optOut, real)})`);
}
if (has("users", "marketing_consent_at")) {
  const notWithdrawn = has("users", "marketing_withdrawn_at") ? " AND marketing_withdrawn_at IS NULL" : "";
  line("  announcement email consent", value(`SELECT COUNT(*) FROM users WHERE ${REAL} AND marketing_consent_at IS NOT NULL${notWithdrawn}`));
}
line("signups, last 7 days", value(`SELECT COUNT(*) FROM users WHERE ${REAL} AND created_at >= ?`, NOW - 7 * DAY));
line("signups, last 30 days", value(`SELECT COUNT(*) FROM users WHERE ${REAL} AND created_at >= ?`, NOW - 30 * DAY));
const byMonth = rows(`SELECT strftime('%Y-%m', created_at/1000, 'unixepoch') m, COUNT(*) c FROM users WHERE ${REAL} GROUP BY m ORDER BY m`);
line("signups by month", byMonth.map((r) => `${r.m}:${r.c}`).join("  "));

// ------------------------------------------------------------------ activity
section("What people actually do (real-looking accounts)");
const realIds = new Set(rows(`SELECT id FROM users WHERE ${REAL}`).map((r) => r.id));
const joinedAt = new Map(rows(`SELECT id, created_at FROM users WHERE ${REAL}`).map((r) => [r.id, Number(r.created_at)]));
// [table, user column, timestamp column, live-row filter column, label]
const ACTIVITY = [
  ["posts", "user_id", "created_at", "removed", "posts (not removed)"],
  ["comments", "user_id", "created_at", "removed", "comments (not removed)"],
  ["likes", "user_id", null, null, "likes"],
  ["follows", "follower_id", null, null, "follows given"],
  ["dms", "from_id", "created_at", "removed", "direct messages sent"],
  ["venue_reviews", "user_id", "created_at", "removed", "venue reviews"],
  ["ratings", "user_id", null, null, "ratings"],
  ["show_attendance", "user_id", "created_at", null, "show attendance marks"],
  ["going", "user_id", "created_at", null, "legacy 'going' marks"],
  ["plays", "user_id", "created_at", null, "song plays"],
  ["playlists", "user_id", "created_at", null, "playlists"],
  ["lounge_messages", "user_id", "created_at", null, "lounge messages"],
  ["reports", "reporter_id", "created_at", null, "reports filed"],
];
const activityTimes = new Map();
const actorsByTable = new Map();
const addTime = (id, time) => {
  if (!activityTimes.has(id)) activityTimes.set(id, []);
  activityTimes.get(id).push(time);
};
for (const [table, userCol, timeCol, liveCol, label] of ACTIVITY) {
  if (!has(table, userCol)) continue;
  const timed = timeCol && has(table, timeCol);
  const live = liveCol && has(table, liveCol) ? `WHERE ${liveCol}=0` : "";
  const list = rows(`SELECT ${userCol} AS u${timed ? `, ${timeCol} AS t` : ""} FROM "${table}" ${live}`).filter((r) => realIds.has(r.u));
  const people = new Set(list.map((r) => r.u));
  actorsByTable.set(table, people);
  line(label, `${list.length} by ${people.size} people (${pct(people.size, real)} of accounts)`);
  if (timed) for (const r of list) addTime(r.u, Number(r.t));
}
const writers = new Set();
for (const table of ["posts", "comments", "venue_reviews", "dms", "lounge_messages"]) {
  for (const id of actorsByTable.get(table) || []) writers.add(id);
}
const anyAction = new Set();
for (const people of actorsByTable.values()) for (const id of people) anyAction.add(id);
line("accounts that wrote anything", `${writers.size} (${pct(writers.size, real)})`);
line("accounts with no recorded action at all", `${real - anyAction.size} (${pct(real - anyAction.size, real)})`);
if (has("posts", "user_id", "removed", "created_at")) {
  const perPoster = rows("SELECT user_id u, COUNT(*) c FROM posts WHERE removed=0 GROUP BY user_id")
    .filter((r) => realIds.has(r.u)).map((r) => r.c).sort((a, b) => b - a);
  const total = perPoster.reduce((sum, c) => sum + c, 0);
  const between = (lo, hi) => perPoster.filter((c) => c >= lo && c <= hi).length;
  line("posters by post count", `1:${between(1, 1)}  2-4:${between(2, 4)}  5-9:${between(5, 9)}  10+:${between(10, Infinity)}`);
  line("share of posts from the top 1 / top 3 posters", `${pct(perPoster[0] || 0, total)} / ${pct(perPoster.slice(0, 3).reduce((s, c) => s + c, 0), total)}`);
  const allLive = value("SELECT COUNT(*) FROM posts WHERE removed=0");
  line("live posts from test or example accounts", `${allLive - total} of ${allLive} (${pct(allLive - total, allLive)})`);
  if (has("posts", "kind")) {
    line("posts by kind (all accounts)", rows("SELECT coalesce(kind,'(none)') k, COUNT(*) c FROM posts WHERE removed=0 GROUP BY k ORDER BY c DESC").map((r) => `${r.k}=${r.c}`).join("  "));
  }
  line("posts in the last 30 days (all accounts)", value("SELECT COUNT(*) FROM posts WHERE removed=0 AND created_at >= ?", NOW - 30 * DAY));
  line("posts removed", value("SELECT COUNT(*) FROM posts WHERE removed<>0"));
}

// ------------------------------------------------------------------ recency
section("Recency and return visits");
if (has("sessions", "user_id", "created_at")) {
  for (const r of rows("SELECT user_id u, created_at t FROM sessions")) if (realIds.has(r.u)) addTime(r.u, Number(r.t));
  if (has("sessions", "expires_at")) line("unexpired sessions", value("SELECT COUNT(*) FROM sessions WHERE expires_at > ?", NOW));
}
const activeWithin = (days) => [...activityTimes.values()].filter((times) => times.some((t) => t >= NOW - days * DAY)).length;
for (const days of [7, 30, 90]) line(`active in the last ${days} days (action or sign-in)`, `${activeWithin(days)} (${pct(activeWithin(days), real)})`);
const cohorts = new Map();
for (const [id, joined] of joinedAt) {
  const month = new Date(joined).toISOString().slice(0, 7);
  const cohort = cohorts.get(month) || { accounts: 0, returned: 0, recent: 0 };
  const times = activityTimes.get(id) || [];
  cohort.accounts += 1;
  if (times.some((t) => t >= joined + 7 * DAY)) cohort.returned += 1;
  if (times.some((t) => t >= NOW - 30 * DAY)) cohort.recent += 1;
  cohorts.set(month, cohort);
}
line("signup month: accounts / came back after week 1 / active last 30 days", "");
for (const [month, c] of [...cohorts].sort()) {
  line(`  ${month}`, `${c.accounts} / ${c.returned} (${pct(c.returned, c.accounts)}) / ${c.recent} (${pct(c.recent, c.accounts)})`);
}
if (has("events", "name", "created_at")) {
  line("analytics events, last 30 days", value("SELECT COUNT(*) FROM events WHERE created_at >= ?", NOW - 30 * DAY));
  for (const r of rows("SELECT name, COUNT(*) c FROM events WHERE created_at >= ? GROUP BY name ORDER BY c DESC LIMIT 12", NOW - 30 * DAY)) {
    line(`  ${r.name}`, r.c);
  }
}
if (has("guest_search_daily", "day", "count")) {
  line("guest searches, last 30 days", value("SELECT COALESCE(SUM(count),0) FROM guest_search_daily WHERE day >= date('now','-30 day')"));
}
if (has("post_impression_totals", "view_count")) line("post views recorded (all time)", value("SELECT COALESCE(SUM(view_count),0) FROM post_impression_totals"));

// ------------------------------------------------------------------ integrity
section("Data model integrity (all accounts)");
if (has("users", "handle")) line("handles that collide ignoring case", value("SELECT COUNT(*) FROM (SELECT lower(handle) h FROM users GROUP BY h HAVING COUNT(*)>1)"));
line("emails that collide ignoring case", value("SELECT COUNT(*) FROM (SELECT lower(email) e FROM users GROUP BY e HAVING COUNT(*)>1)"));
if (has("posts", "artist_key", "removed")) line("live posts without an artist key", value("SELECT COUNT(*) FROM posts WHERE removed=0 AND coalesce(artist_key,'')=''"));
if (has("posts", "venue_key", "removed")) line("live posts without a venue key", value("SELECT COUNT(*) FROM posts WHERE removed=0 AND coalesce(venue_key,'')=''"));
if (tables.has("posts") && !columns("posts").has("show_id")) line("posts linked to a canonical show", "not possible: posts has no show id column");
if (has("show_attendance", "show_id")) line("attendance rows without a show", value("SELECT COUNT(*) FROM show_attendance WHERE show_id IS NULL OR show_id=''"));
if (has("likes", "post_id") && tables.has("posts")) line("likes pointing at missing posts", value("SELECT COUNT(*) FROM likes l LEFT JOIN posts p ON p.id=l.post_id WHERE p.id IS NULL"));
if (has("comments", "post_id") && tables.has("posts")) line("comments pointing at missing posts", value("SELECT COUNT(*) FROM comments c LEFT JOIN posts p ON p.id=c.post_id WHERE p.id IS NULL"));
line("foreign key violations", rows("PRAGMA foreign_key_check").length);
line("quick_check", rows("PRAGMA quick_check").map((r) => Object.values(r)[0]).join("; ").slice(0, 120));

// ------------------------------------------------------------------ catalog
section("Catalog imported from providers");
if (tables.has("artists")) {
  const artists = value("SELECT COUNT(*) FROM artists");
  line("artists", artists);
  for (const [col, label] of [["photo", "with a photo"], ["mbid", "with a MusicBrainz id"], ["genre", "with a genre"], ["youtube_channel_id", "with a YouTube channel"]]) {
    if (!has("artists", col)) continue;
    const count = value(`SELECT COUNT(*) FROM artists WHERE coalesce(${col},'')<>''`);
    line(`  ${label}`, `${count} (${pct(count, artists)})`);
  }
}
if (tables.has("tour_dates")) {
  const events = value("SELECT COUNT(*) FROM tour_dates");
  line("tour dates / events", events);
  if (has("tour_dates", "date")) {
    line("  today or later", value("SELECT COUNT(*) FROM tour_dates WHERE date >= ?", TODAY));
    line("  already past", value("SELECT COUNT(*) FROM tour_dates WHERE date < ?", TODAY));
  }
  if (has("tour_dates", "provider_active")) line("  no longer listed by the provider", value("SELECT COUNT(*) FROM tour_dates WHERE provider_active=0"));
  if (has("tour_dates", "music_qualified")) {
    line("  music_qualified", rows("SELECT coalesce(music_qualified,'null') k, COUNT(*) c FROM tour_dates GROUP BY k ORDER BY c DESC").map((r) => `${r.k}=${r.c}`).join("  "));
  }
  if (has("tour_dates", "event_kind")) {
    line("  event kinds", rows("SELECT coalesce(event_kind,'null') k, COUNT(*) c FROM tour_dates GROUP BY k ORDER BY c DESC LIMIT 8").map((r) => `${r.k}=${r.c}`).join("  "));
  }
  if (has("tour_dates", "event_name")) {
    const addOnWords = ["souvenir", "parking", "package", "upgrade", "voucher", "add-on", "tailgate", "shuttle", "locker", "camping"];
    const clause = [...addOnWords.map((w) => `lower(coalesce(event_name,'')) GLOB '*${w}*'`), "lower(coalesce(event_name,'')) GLOB '* vip *'"].join(" OR ");
    const addOns = value(`SELECT COUNT(*) FROM tour_dates WHERE ${clause}`);
    line("  names that look like ticket add-ons", `${addOns} (${pct(addOns, events)})`);
  }
  if (has("tour_dates", "venue")) line("  distinct venue names", value("SELECT COUNT(DISTINCT lower(venue)) FROM tour_dates"));
}
if (tables.has("shows")) {
  line("canonical shows", value("SELECT COUNT(*) FROM shows"));
  if (has("show_attendance", "show_id")) line("  shows anyone marked attendance for", value("SELECT COUNT(DISTINCT show_id) FROM show_attendance WHERE show_id IS NOT NULL"));
}

// ------------------------------------------------------------------ privacy
section("Privacy-sensitive storage (counts only)");
if (has("sessions", "ip")) line("sessions storing a raw IP", value("SELECT COUNT(*) FROM sessions WHERE coalesce(ip,'')<>''"));
if (has("sessions", "ua")) line("sessions storing a user agent", value("SELECT COUNT(*) FROM sessions WHERE coalesce(ua,'')<>''"));
if (has("events", "ip")) line("analytics events storing a raw IP", value("SELECT COUNT(*) FROM events WHERE coalesce(ip,'')<>''"));
if (has("users", "spotify_refresh_token", "spotify_access_token")) {
  line("accounts still holding Spotify tokens", value("SELECT COUNT(*) FROM users WHERE coalesce(spotify_refresh_token,'')<>'' OR coalesce(spotify_access_token,'')<>''"));
}
if (has("users", "reset_hash", "reset_expires")) line("open password-reset tokens", value("SELECT COUNT(*) FROM users WHERE reset_hash IS NOT NULL AND coalesce(reset_expires,0) > ?", NOW));
if (tables.has("error_events")) line("grouped error records", value("SELECT COUNT(*) FROM error_events"));

db.close();
