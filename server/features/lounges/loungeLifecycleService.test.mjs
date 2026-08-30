import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { ensureLoungeSchema } from "./loungeSchema.js";
import {
  createLoungeLifecycleService,
  LOUNGE_CLOSE_DELAY_MS,
  loungeArchiveRetentionPolicy,
  resolveLoungeWindow,
} from "./loungeLifecycleService.js";

test("Lounge closes at the exact doors-open boundary and falls back explicitly to show start", () => {
  const doors = 1_000_000;
  const start = 2_000_000;
  assert.deepEqual(resolveLoungeWindow({ doorsOpenAt: doors, showStartAt: start }, doors + LOUNGE_CLOSE_DELAY_MS - 1), {
    status: "open",
    timingKnown: true,
    cutoffAt: doors + LOUNGE_CLOSE_DELAY_MS,
    cutoffSource: "doors_open",
  });
  assert.equal(resolveLoungeWindow({ doorsOpenAt: doors, showStartAt: start }, doors + LOUNGE_CLOSE_DELAY_MS).status, "closed");
  assert.equal(resolveLoungeWindow({ showStartAt: start }, start).cutoffSource, "show_start");
  assert.deepEqual(resolveLoungeWindow({}, start), {
    status: "open",
    timingKnown: false,
    cutoffAt: null,
    cutoffSource: null,
  });
});

test("lazy lifecycle cleanup deletes empty rooms and archives nonempty rooms without purging", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE shows (id TEXT PRIMARY KEY);
    CREATE TABLE going (user_id TEXT,concert_key TEXT,artist TEXT,created_at INTEGER);
    CREATE TABLE lounge_messages (
      id TEXT PRIMARY KEY,lounge_id TEXT NOT NULL,user_id TEXT NOT NULL,text TEXT NOT NULL,
      removed INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL
    );
  `);
  ensureLoungeSchema(database);
  const shows = new Map();
  const attendanceRepository = { resolveShow: (key) => shows.get(key) || null };
  const atomicWrite = (work) => {
    database.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      database.exec("COMMIT");
      return result;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  };
  const service = createLoungeLifecycleService({
    database,
    attendanceRepository,
    atomicWrite,
    env: { LOUNGE_ARCHIVE_RETENTION_POLICY: "privacy-review-v1", LOUNGE_ARCHIVE_REVIEW_DAYS: "30" },
  });
  const start = 5_000_000;
  const cutoff = start + LOUNGE_CLOSE_DELAY_MS;

  shows.set("empty", { id: "show-empty", persisted: true, artist: "Empty Artist", startAt: start });
  database.prepare("INSERT INTO shows (id) VALUES (?)").run("show-empty");
  assert.equal(service.snapshot("empty", start, { register: true }).status, "open");
  assert.equal(database.prepare("SELECT COUNT(*) count FROM concert_lounges WHERE lounge_id='empty'").get().count, 1);
  assert.equal(service.snapshot("empty", cutoff).status, "closed");
  assert.equal(database.prepare("SELECT COUNT(*) count FROM concert_lounges WHERE lounge_id='empty'").get().count, 0);

  shows.set("kept", { id: "show-kept", persisted: true, artist: "Kept Artist", startAt: start });
  database.prepare("INSERT INTO shows (id) VALUES (?)").run("show-kept");
  service.snapshot("kept", start, { register: true });
  database.prepare("INSERT INTO lounge_messages (id,lounge_id,user_id,text,created_at) VALUES (?,?,?,?,?)")
    .run("message-1", "kept", "fan-1", "moderation evidence", start + 1);
  const closed = service.snapshot("kept", cutoff);
  assert.equal(closed.status, "closed");
  assert.equal(closed.archived, true);
  assert.equal(closed.retentionPolicyKey, "privacy-review-v1");
  assert.equal(closed.retentionReviewAt, cutoff + 30 * LOUNGE_CLOSE_DELAY_MS);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM lounge_messages WHERE lounge_id='kept'").get().count, 1, "archive reconciliation must not purge messages");
  assert.deepEqual({ ...database.prepare(`SELECT status,closed_at,retention_policy_key FROM concert_lounges WHERE lounge_id='kept'`).get() }, {
    status: "archived",
    closed_at: cutoff,
    retention_policy_key: "privacy-review-v1",
  });
  database.close();
});

test("the default archive policy is an explicit approval hook, not an indefinite-retention claim", () => {
  assert.deepEqual(loungeArchiveRetentionPolicy(123, {}), {
    key: "approval-pending",
    reviewAt: null,
  });
});
