import test from "node:test";
import assert from "node:assert/strict";
import { db, q, providerCacheStmts, ytStmts, STORAGE_MAINTENANCE_BATCH_SIZE } from "./db.js";

function transaction(fn) {
  db.exec("SAVEPOINT storage_maintenance_fixture");
  try { fn(); }
  finally { db.exec("ROLLBACK TO storage_maintenance_fixture; RELEASE storage_maintenance_fixture"); }
}

test("session pruning is expiry-indexed, bounded, and never removes a live session", () => transaction(() => {
  db.prepare("INSERT INTO users(id,email,name,handle,pass_hash,created_at) VALUES (?,?,?,?,?,?)")
    .run("storage-fixture-user", "storage@example.invalid", "Fixture", "storage_fixture", "fixture-hash", 1);
  const insert = db.prepare(`INSERT INTO sessions(token_hash,user_id,created_at,expires_at,ip,ua)
    VALUES (?,(SELECT id FROM users LIMIT 1),0,?,'','')`);
  for (let index = 0; index < 503; index++) insert.run(`storage-expired-${index}`, 1);
  insert.run("storage-live-session", Date.now() + 3600_000);
  const pruned = q.deleteExpiredSessions.run(2);
  assert.equal(pruned.changes, STORAGE_MAINTENANCE_BATCH_SIZE);
  assert.ok(q.sessionByHash.get("storage-live-session"));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sessions WHERE token_hash LIKE 'storage-expired-%'").get().n, 3);
  const plan = db.prepare("EXPLAIN QUERY PLAN SELECT token_hash FROM sessions WHERE expires_at < ? ORDER BY expires_at,token_hash LIMIT 500").all(2);
  assert.match(plan.map((row) => row.detail).join(" "), /COVERING INDEX idx_sessions_expiry/);
}));

test("cache expiry preserves saved artist recovery and caps each synchronous delete", () => transaction(() => {
  for (let index = 0; index < 503; index++) providerCacheStmts.set.run(`storage-expired-${index}`, "{}", 0, 1);
  providerCacheStmts.set.run("mbresolve:v1:storage-recovery", '{"mbid":"preserve"}', 0, 1);
  providerCacheStmts.set.run("storage-fresh", "{}", 0, 9999);
  assert.equal(providerCacheStmts.deleteExpired.run(2).changes, 500);
  assert.ok(providerCacheStmts.get.get("mbresolve:v1:storage-recovery"));
  assert.ok(providerCacheStmts.get.get("storage-fresh"));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM provider_cache WHERE key LIKE 'storage-expired-%'").get().n, 3);
  const plan = db.prepare("EXPLAIN QUERY PLAN SELECT key FROM provider_cache WHERE expires_at < ? AND key NOT LIKE 'mbresolve:v1:%' ORDER BY expires_at,key LIMIT 500").all(2);
  assert.match(plan.map((row) => row.detail).join(" "), /COVERING INDEX idx_provider_cache_prunable_expiry/);
}));

test("identity cap evicts only overflow in batches, keeping newest recoveries", () => transaction(() => {
  for (let index = 0; index < 503; index++) providerCacheStmts.set.run(`mbresolve:v1:storage-${index}`, "{}", index, 1);
  providerCacheStmts.set.run("storage-unrelated", "{}", 0, 1);
  assert.equal(providerCacheStmts.trimMusicBrainzResolutions.run(2).changes, 500);
  assert.ok(providerCacheStmts.get.get("mbresolve:v1:storage-502"));
  assert.ok(providerCacheStmts.get.get("mbresolve:v1:storage-501"));
  assert.ok(providerCacheStmts.get.get("storage-unrelated"));
  assert.equal(providerCacheStmts.trimMusicBrainzResolutions.run(2).changes, 1);
  assert.equal(providerCacheStmts.trimMusicBrainzResolutions.run(2).changes, 0);
}));

test("YouTube expiry handles current and legacy rows with the same bounded budget", () => transaction(() => {
  const insert = db.prepare("INSERT INTO yt_cache(key,video_id,updated_at,expires_at) VALUES (?,NULL,?,?)");
  for (let index = 0; index < 503; index++) insert.run(`storage-yt-${index}`, 1, index % 2 ? null : 1);
  insert.run("storage-yt-fresh", 9999, 9999);
  assert.equal(ytStmts.deleteExpired.run(2, 2).changes, 500);
  assert.ok(ytStmts.get.get("storage-yt-fresh"));
  assert.equal(ytStmts.deleteExpired.run(2, 2).changes, 3);
  const plan = db.prepare("EXPLAIN QUERY PLAN SELECT key FROM yt_cache WHERE expires_at <= ? UNION ALL SELECT key FROM yt_cache WHERE expires_at IS NULL AND updated_at <= ? LIMIT 500").all(2, 2);
  const detail = plan.map((row) => row.detail).join(" ");
  assert.match(detail, /idx_yt_cache_expiry/);
  assert.match(detail, /idx_yt_cache_expiry \(expires_at=\? AND updated_at<\?\)/);
}));
