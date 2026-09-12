import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createErrorAlertDelivery, ensureErrorAlertSchema, providerBlipThreshold } from "./errorAlertDelivery.js";

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
  assert.equal(batch.rows[0].last_seen, now);
  database.prepare("UPDATE error_events SET count=2,last_seen=? WHERE fingerprint='a'").run(now + 60_000);
  const restarted = createErrorAlertDelivery(database);
  assert.deepEqual(restarted.nextBatch({ now: now + HOUR }).batch, batch);
  restarted.acknowledge(batch.key, now + HOUR);
  const next = restarted.nextBatch({ now: now + 2 * HOUR }).batch;
  assert.equal(next.rows[0].count, 1);
  assert.equal(next.rows[0].through_count, 2);
  assert.equal(next.rows[0].last_seen, now + 60_000);
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

function longEvent(database, fingerprint, at) {
  database.prepare("INSERT INTO error_events VALUES (?,'fatal',?,0,'POST',?,?,?,1,?,?)")
    .run(fingerprint, "PIT-APP-" + "0".repeat(32), "/client/" + "r".repeat(72), "RenderError.Web." + "c".repeat(64),
      "123e4567-e89b-42d3-a456-426614174000", at, at);
  database.prepare("INSERT INTO error_occurrence_buckets VALUES (?,?,?)").run(fingerprint, Math.floor(at / HOUR) * HOUR, 1);
}

test("where and why are frozen into the batch and trimmed from the oldest rows to respect the payload CHECK", (t) => {
  const database = fixture(t);
  const now = 200 * HOUR;
  ensureErrorAlertSchema(database, { now });
  for (let index = 0; index < 20; index += 1) {
    longEvent(database, `fp${String(index).padStart(2, "0")}`, now - (20 - index) * 60_000);
  }
  const huge = {
    location: `server/musicProviders.js:164:12 in coalescedProviderJob ${"x".repeat(400)}`,
    reason: `AbortError [20]: ${"y".repeat(700)}`,
    release: "4603cb3e6084",
  };
  let lookups = 0;
  const delivery = createErrorAlertDelivery(database, {
    detailsFor: (fingerprints) => {
      lookups += 1;
      return new Map(fingerprints.map((fingerprint) => [fingerprint, huge]));
    },
  });
  const { batch } = delivery.nextBatch({ now, force: true });
  const stored = database.prepare("SELECT pending_payload FROM error_alert_delivery WHERE singleton=1").get().pending_payload;
  assert.ok(stored.length <= 22_000, `frozen payload is ${stored.length} characters`);
  const untrimmed = JSON.stringify({
    rows: batch.rows.map((row) => ({ ...row, detail: batch.rows.at(-1).detail })),
    initialCatchUp: batch.initialCatchUp,
  });
  assert.ok(untrimmed.length > 24_000, "without trimming this batch would violate the database CHECK and stop alerts");

  assert.equal(batch.rows.length, 20, "trimming detail never drops an error");
  const detailed = batch.rows.map((row) => Boolean(row.detail));
  assert.ok(detailed.includes(false) && detailed.includes(true));
  // Rows are oldest first: the oldest lose detail first, the most recent keep it.
  assert.ok(detailed.indexOf(true) > detailed.lastIndexOf(false));
  assert.equal(batch.rows.at(-1).detail.location.length, 240);
  assert.equal(batch.rows.at(-1).detail.release, "4603cb3e6084");

  // A retry reuses the frozen batch rather than looking detail up again.
  assert.deepEqual(delivery.nextBatch({ now: now + HOUR, force: true }).batch, batch);
  assert.equal(lookups, 1);
});

test("an unreadable detail table never blocks the alert", (t) => {
  const database = fixture(t);
  const now = 200 * HOUR;
  ensureErrorAlertSchema(database, { now });
  event(database, { fingerprint: "only", at: now - 60_000 });
  const delivery = createErrorAlertDelivery(database, { detailsFor: () => { throw new Error("no such table"); } });
  const { batch } = delivery.nextBatch({ now, force: true });
  assert.equal(batch.rows.length, 1);
  assert.equal(batch.rows[0].detail, undefined);
});

function providerEvent(database, { fingerprint, count, at, cause = "ProviderError/http_error" }) {
  database.prepare(`INSERT INTO error_events
    (fingerprint,level,code,status,method,route,cause,last_request_id,count,first_seen,last_seen)
    VALUES (?,'error','PROVIDER_UNAVAILABLE',502,'GET','/api/artists/resolve',?,NULL,?,?,?)`)
    .run(fingerprint, cause, count, at, at);
  database.prepare("INSERT INTO error_occurrence_buckets VALUES (?,?,?)")
    .run(fingerprint, Math.floor(at / HOUR) * HOUR, count);
}

test("a short upstream blip waits while a sustained outage and rate limiting mail out", (t) => {
  const database = fixture(t);
  const now = 300 * HOUR;
  ensureErrorAlertSchema(database, { now });
  providerEvent(database, { fingerprint: "blip", count: 2, at: now - 4 * 60_000 });
  providerEvent(database, { fingerprint: "outage", count: 12, at: now - 3 * 60_000 });
  providerEvent(database, { fingerprint: "limited", count: 2, at: now - 2 * 60_000, cause: "ProviderError/rate_limited" });
  const delivery = createErrorAlertDelivery(database);

  const { batch } = delivery.nextBatch({ now });
  assert.deepEqual(batch.rows.map((row) => row.fingerprint), ["outage", "limited"]);
  delivery.acknowledge(batch.key, now);

  // The held blip is not dropped: it mails once it accumulates past the threshold.
  database.prepare("UPDATE error_events SET count=10,last_seen=? WHERE fingerprint='blip'").run(now + 60_000);
  const later = delivery.nextBatch({ now: now + 31 * 60_000 });
  assert.deepEqual(later.batch.rows.map((row) => [row.fingerprint, row.count]), [["blip", 10]]);
});

test("the provider blip threshold is tunable and refuses nonsense", () => {
  assert.equal(providerBlipThreshold({}), 10);
  assert.equal(providerBlipThreshold({ ERROR_ALERT_PROVIDER_MIN: "3" }), 3);
  assert.equal(providerBlipThreshold({ ERROR_ALERT_PROVIDER_MIN: "0" }), 10);
  assert.equal(providerBlipThreshold({ ERROR_ALERT_PROVIDER_MIN: "abc" }), 10);
});
