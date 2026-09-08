import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createErrorAlertDelivery, ensureErrorAlertSchema } from "./errorAlertDelivery.js";

const HOUR = 3_600_000;
function fixture(t) {
  const database = new DatabaseSync(":memory:");
  database.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE error_events (fingerprint TEXT PRIMARY KEY,level TEXT,code TEXT,status INTEGER,
      method TEXT,route TEXT,cause TEXT,last_request_id TEXT,count INTEGER,first_seen INTEGER,last_seen INTEGER);
    CREATE TABLE error_occurrence_buckets (fingerprint TEXT,hour_start INTEGER,count INTEGER);`);
  t.after(() => database.close());
  return database;
}
function event(database, { fingerprint = "a", count = 1, at, status = 0 } = {}) {
  database.prepare("INSERT INTO error_events VALUES (?,'fatal','PIT-APP-001',?,'POST','/client/landing','RenderError.Web',NULL,?,?,?)")
    .run(fingerprint, status, count, at, at);
  database.prepare("INSERT INTO error_occurrence_buckets VALUES (?,?,?)").run(fingerprint, Math.floor(at / HOUR) * HOUR, count);
}

test("upgrade baselines old history but preserves recent faults as explicit initial catch-up", (t) => {
  const database = fixture(t);
  const now = 100 * HOUR + 45 * 60_000;
  event(database, { fingerprint: "old", count: 50, at: now - 2 * HOUR });
  event(database, { fingerprint: "recent", count: 1, at: now - 5 * 60_000 });
  event(database, { fingerprint: "unbucketed", count: 3, at: now - 4 * 60_000 });
  database.exec("DELETE FROM error_occurrence_buckets WHERE fingerprint='unbucketed'");
  // This fingerprint has old history as well as a recent occurrence. The
  // initial catch-up must not replay its whole lifetime count.
  database.prepare("UPDATE error_events SET count=21,first_seen=? WHERE fingerprint='recent'").run(now - 10 * HOUR);
  database.prepare("INSERT INTO error_occurrence_buckets VALUES ('recent',?,20)").run(90 * HOUR);
  ensureErrorAlertSchema(database, { now });
  const delivery = createErrorAlertDelivery(database);
  const { batch } = delivery.nextBatch({ now });
  assert.equal(batch.initialCatchUp, true);
  assert.deepEqual(batch.rows.map((row) => [row.fingerprint, row.count, row.through_count]), [["recent", 1, 21], ["unbucketed", 3, 3]]);
  delivery.acknowledge(batch.key, now);
  // Booting later must not rebuild or clear successful checkpoints.
  ensureErrorAlertSchema(database, { now: now + HOUR });
  assert.equal(createErrorAlertDelivery(database).nextBatch({ now: now + HOUR }).reason, "nothing-serious");
});

test("digest selection stays bounded and unselected fingerprints remain pending", (t) => {
  const database = fixture(t);
  const now = 100 * HOUR;
  ensureErrorAlertSchema(database, { now });
  for (let i = 0; i < 25; i += 1) event(database, { fingerprint: `f${i}`, at: now });
  const delivery = createErrorAlertDelivery(database);
  const first = delivery.nextBatch({ now }).batch;
  assert.equal(first.rows.length, 20);
  assert.equal(first.initialCatchUp, false);
  delivery.acknowledge(first.key, now);
  const second = delivery.nextBatch({ now: now + HOUR }).batch;
  assert.equal(second.rows.length, 5);
  assert.equal(second.rows.some((row) => first.rows.some((sent) => sent.fingerprint === row.fingerprint)), false);
});

test("pending batches survive repository recreation without absorbing newer occurrences", (t) => {
  const database = fixture(t);
  const now = 100 * HOUR;
  ensureErrorAlertSchema(database, { now });
  event(database, { at: now });
  const batch = createErrorAlertDelivery(database).nextBatch({ now }).batch;
  database.exec("UPDATE error_events SET count=2 WHERE fingerprint='a'");
  const restarted = createErrorAlertDelivery(database);
  assert.deepEqual(restarted.nextBatch({ now: now + HOUR }).batch, batch);
  restarted.acknowledge(batch.key, now + HOUR);
  const next = restarted.nextBatch({ now: now + 2 * HOUR }).batch;
  assert.equal(next.rows[0].count, 1);
  assert.equal(next.rows[0].through_count, 2);
  assert.notEqual(next.key, batch.key);
});

test("a pruned and recreated fingerprint is not acknowledged as the older generation", (t) => {
  const database = fixture(t);
  const now = 100 * HOUR;
  ensureErrorAlertSchema(database, { now });
  event(database, { count: 8, at: now });
  const delivery = createErrorAlertDelivery(database);
  const original = delivery.nextBatch({ now }).batch;
  database.exec("DELETE FROM error_events WHERE fingerprint='a'");
  event(database, { at: now + 1 });
  delivery.acknowledge(original.key, now + 2);
  const next = delivery.nextBatch({ now: now + HOUR }).batch;
  assert.equal(next.rows[0].count, 1);
});
