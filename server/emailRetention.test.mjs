import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  emailOperationalRetentionDays,
  pruneEmailOperationalData,
} from "./emailRetention.js";

test("email operational retention is bounded and defaults to 90 days", () => {
  assert.equal(emailOperationalRetentionDays({}), 90);
  assert.equal(emailOperationalRetentionDays({ EMAIL_OPERATIONAL_RETENTION_DAYS: "7" }), 30);
  assert.equal(emailOperationalRetentionDays({ EMAIL_OPERATIONAL_RETENTION_DAYS: "120" }), 120);
  assert.equal(emailOperationalRetentionDays({ EMAIL_OPERATIONAL_RETENTION_DAYS: "900" }), 365);
});

test("retention removes old recipient metadata without touching unfinished queues", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE email_campaigns (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER,
      finished_at INTEGER
    );
    CREATE TABLE email_queue (
      id INTEGER PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      to_email TEXT NOT NULL
    );
    CREATE TABLE email_log (
      id INTEGER PRIMARY KEY,
      created_at INTEGER NOT NULL,
      to_email TEXT NOT NULL
    );
  `);
  const day = 24 * 60 * 60 * 1000;
  const at = 200 * day;
  const old = at - 91 * day;
  const recent = at - 10 * day;
  const campaign = database.prepare("INSERT INTO email_campaigns VALUES (?,?,?,?,?)");
  campaign.run("old-sent", "sent", old, old, old);
  campaign.run("old-paused", "paused", old, old, null);
  campaign.run("recent-sent", "sent", recent, recent, recent);
  const queue = database.prepare("INSERT INTO email_queue VALUES (?,?,?)");
  queue.run(1, "old-sent", "old-sent@example.test");
  queue.run(2, "old-paused", "old-paused@example.test");
  queue.run(3, "recent-sent", "recent@example.test");
  database.prepare("INSERT INTO email_log VALUES (?,?,?)").run(1, old, "old@example.test");
  database.prepare("INSERT INTO email_log VALUES (?,?,?)").run(2, recent, "recent@example.test");

  const result = pruneEmailOperationalData(database, { at, env: {} });

  assert.equal(result.emailLogRows, 1);
  assert.equal(result.terminalQueueRows, 1);
  assert.deepEqual(database.prepare("SELECT id FROM email_log ORDER BY id").all().map((row) => row.id), [2]);
  assert.deepEqual(database.prepare("SELECT id FROM email_queue ORDER BY id").all().map((row) => row.id), [2, 3]);
  database.close();
});
