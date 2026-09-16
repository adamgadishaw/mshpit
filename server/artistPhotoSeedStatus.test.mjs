import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createArtistPhotoSeedReporter, readArtistPhotoSeedStatus } from "./artistPhotoSeedStatus.js";
import { ensureCatalogKnowledgeControl, setCatalogKnowledgeMode } from "./catalogKnowledgeControl.js";

const AT = Date.parse("2026-09-16T12:00:00Z");
const env = { ARTIST_PHOTO_SEED_ENABLED: "true", SPOTIFY_CLIENT_ID: "private-id", SPOTIFY_CLIENT_SECRET: "private-secret" };
function fixture() { const database = new DatabaseSync(":memory:"); database.exec("CREATE TABLE app_meta(key TEXT PRIMARY KEY,value TEXT)"); return database; }

test("photo status is sanitized, bounded, durable and strictly read-only", () => {
  const database = fixture();
  try {
    const reporter = createArtistPhotoSeedReporter({ database, clock: () => AT });
    reporter.update({ phase: "running", nextPassAt: AT + 900000 });
    reporter.finish({ attempted: 20, filled: 17, noMatch: 2, skipped: 1, failed: 0, priorityAttempted: 15, name: "Private Artist", url: "https://secret.example", token: "private-secret" }, { startedAt: AT - 5000 });
    const readOnly = { prepare(sql) { assert.match(sql, /^SELECT /); return database.prepare(sql); } };
    const status = readArtistPhotoSeedStatus({ env, at: AT, database: readOnly });
    assert.equal(status.enabled, true); assert.equal(status.configured, true); assert.equal(status.batchSize, 20);
    assert.equal(status.lastPass.at, AT); assert.equal(status.lastPass.filled, 17);
    assert.equal(status.lastPass.priorityAttempted, 15); assert.equal(status.lastPass.skipped, 1);
    assert.doesNotMatch(JSON.stringify(status), /Private Artist|secret|https|token/);
    assert.doesNotMatch(database.prepare("SELECT value FROM app_meta").get().value, /Private Artist|secret|https|token/);
    assert.equal(readArtistPhotoSeedStatus({ env, at: AT, database }).running, true);
    reporter.finish({ attempted: 100000, filled: -1, failed: Infinity, noMatch: 2, error: "private-secret" }, { startedAt: AT - 1, pauseReason: "private-secret" });
    const bounded = readArtistPhotoSeedStatus({ env, at: AT, database });
    assert.equal(bounded.lastPass.attempted, 40); assert.equal(bounded.lastPass.filled, 0); assert.equal(bounded.lastPass.failed, 0);
    assert.equal(bounded.lastPass.pauseReason, null);
  } finally { database.close(); }
});

test("disabled, missing credentials, shared pause and cooldown are explicit without mutating expired backoff", () => {
  const database = fixture();
  try {
    assert.equal(readArtistPhotoSeedStatus({ env: {}, at: AT, database }).phase, "disabled");
    assert.equal(readArtistPhotoSeedStatus({ env: { ARTIST_PHOTO_SEED_ENABLED: "true" }, at: AT, database }).pauseReason, "credentials_unavailable");
    database.prepare("INSERT INTO app_meta VALUES (?,?)").run("spotify_artist_photo_backoff_v1", JSON.stringify({ until: AT + 1000, code: "quota_exceeded" }));
    assert.equal(readArtistPhotoSeedStatus({ env, at: AT, database }).pauseReason, "quota_exceeded");
    assert.equal(readArtistPhotoSeedStatus({ env, at: AT + 1001, database }).retryAt, null);
    assert.equal(database.prepare("SELECT COUNT(*) c FROM app_meta").get().c, 1, "GET does not delete expired backoff");
    ensureCatalogKnowledgeControl(database, { env, at: AT }); setCatalogKnowledgeMode(database, "paused", { env, at: AT });
    assert.equal(readArtistPhotoSeedStatus({ env, at: AT, database }).pauseReason, "catalog_paused");
  } finally { database.close(); }
});

test("late completion from a replaced scheduler cannot replace current progress", () => {
  const database = fixture();
  try {
    const older = createArtistPhotoSeedReporter({ database, clock: () => AT });
    const current = createArtistPhotoSeedReporter({ database, clock: () => AT + 1 });
    current.update({ phase: "running" }); current.finish({ attempted: 1, filled: 1 });
    older.update({ phase: "stopped" }); older.finish({ attempted: 20, filled: 20 });
    const result = readArtistPhotoSeedStatus({ env, at: AT, database });
    assert.equal(result.running, true); assert.equal(result.lastPass.filled, 1); assert.equal(result.lastPass.at, AT + 1);
  } finally { database.close(); }
});

test("missing or unavailable database status fails closed without schema writes or raw errors", () => {
  const missingSchema = new DatabaseSync(":memory:");
  const closed = fixture(); closed.close();
  const unavailable = { prepare(sql) { assert.match(sql, /^SELECT /); throw new Error("private-db-path secret-token"); } };
  try {
    for (const database of [undefined, missingSchema, closed, unavailable]) {
      const result = readArtistPhotoSeedStatus({ env, at: AT, database });
      assert.equal(result.available, false); assert.equal(result.phase, "unavailable");
      assert.equal(result.pauseReason, "status_unavailable"); assert.equal(result.running, false);
      assert.equal(result.lastPass, null); assert.equal(result.nextPassAt, null);
      assert.doesNotMatch(JSON.stringify(result), /private-db|secret|token/);
    }
    assert.equal(missingSchema.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table'").get().c, 0);
    let selects = 0;
    const controlUnavailable = { prepare(sql) { assert.match(sql, /^SELECT /); return { get() { if (++selects === 3) throw new Error("control unavailable"); return undefined; } }; } };
    assert.equal(readArtistPhotoSeedStatus({ env, at: AT, database: controlUnavailable }).phase, "unavailable");
  } finally { missingSchema.close(); }
});
