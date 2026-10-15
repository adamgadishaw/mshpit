import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { claudeMonthSpendMicroUsd } from "../../claudeSpendCeiling.js";
import { collectClaudeSpendStatus } from "../../claudeSpendStatus.js";
import { assertPublicHost, publicAddress, runNewsDeskPass } from "./newsDeskJob.js";
import { ensureNewsDeskSchema } from "./newsDeskService.js";
import { collectNewsDeskStatus, newsDeskPassReason, nextNewsSlot, recordNewsDeskFailure, recordNewsDeskPass } from "./newsDeskStatus.js";

// 2026-09-27 15:10 in Toronto (EDT, UTC-4).
const AT = Date.parse("2026-09-27T19:10:00Z");

function database(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec("CREATE TABLE app_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
  ensureNewsDeskSchema(db);
  return db;
}

test("each pass outcome has one reason code", () => {
  assert.equal(newsDeskPassReason({ published: 1, slot: "open" }), "published");
  assert.equal(newsDeskPassReason({ slot: "next_slot", waiting: 1 }), "waiting_for_slot");
  assert.equal(newsDeskPassReason({ slot: "day_full", waiting: 1 }), "day_full");
  assert.equal(newsDeskPassReason({ slot: "too_soon", waiting: 1 }), "too_soon");
  assert.equal(newsDeskPassReason({ slot: "open", skippedForBudget: 1 }), "budget");
  assert.equal(newsDeskPassReason({ slot: "open", declined: 2 }), "declined");
  assert.equal(newsDeskPassReason({ slot: "open", confirmed: 0 }), "no_qualifying_story");
  assert.equal(newsDeskPassReason({ publisherReason: "publisher_account_unavailable" }), "publisher_paused");
});

test("the next publishing slot is named in Toronto time", () => {
  const editorial = { timeZone: "America/Toronto", slotHours: [8, 11, 14, 17, 20], slotLengthHours: 0.5 };
  assert.equal(nextNewsSlot(AT, editorial).label, "17:00");
  assert.equal(nextNewsSlot(Date.parse("2026-09-27T18:10:00Z"), editorial).label, "14:00 (open now)");
  assert.equal(nextNewsSlot(Date.parse("2026-09-28T01:00:00Z"), editorial).label, "tomorrow 08:00");
});

test("the status shows the last check, today's stories, spending by kind and the last problem", (t) => {
  const db = database(t);
  const env = { ANTHROPIC_API_KEY: "key", NEWS_DESK_ENABLED: "true" };
  let status = collectNewsDeskStatus(db, { env, at: AT });
  assert.equal(status.lastPass, null);
  assert.equal(status.lastError, null);
  assert.equal(status.configured, true);
  assert.deepEqual(status.spend.today, { confirmedUsd: 0, heldUsd: 0, unconfirmedUsd: 0 });

  const story = db.prepare("INSERT INTO news_stories (id,status,headline,summary,post_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?)");
  story.run("today", "published", "Today", "s", "news_today", AT - 3_600_000, AT);
  story.run("yesterday", "published", "Late last night", "s", "news_yesterday", Date.parse("2026-09-27T03:30:00Z"), AT);
  story.run("no", "declined", "", "", null, AT - 7_200_000, AT);
  const receipt = db.prepare("INSERT INTO news_desk_receipts (token,day,reserved_usd,charged_usd,status,created_at) VALUES (?,?,?,?,?,?)");
  receipt.run("a", "2026-09-27", 0.05, 0.02, "settled", AT);
  receipt.run("b", "2026-09-27", 0.05, 0.05, "reserved", AT);
  receipt.run("c", "2026-09-03", 0.04, 0.04, "uncertain", AT);
  db.prepare("INSERT INTO news_desk_spend (day,usd) VALUES ('2026-09-02',0.10)").run();

  assert.equal(recordNewsDeskPass(db, { at: AT, reportsAdded: 12, result: { confirmed: 0, slot: "next_slot", waiting: 1, picked: [] } }), true);
  recordNewsDeskFailure(db, { at: AT - 60_000, label: "anthropic_error", detail: "status=529 type=overloaded_error" });
  status = collectNewsDeskStatus(db, { env, at: AT });
  assert.deepEqual({ reason: status.lastPass.reason, reportsAdded: status.lastPass.reportsAdded }, { reason: "waiting_for_slot", reportsAdded: 12 });
  assert.equal(status.lastError.detail, "status=529 type=overloaded_error");
  assert.equal(status.publishedToday, 1, "the 11:30pm story belongs to the previous Toronto day");
  assert.equal(status.published7d, 2);
  assert.equal(status.declined7d, 1);
  assert.deepEqual(status.spend.today, { confirmedUsd: 0.02, heldUsd: 0.05, unconfirmedUsd: 0 });
  assert.deepEqual(status.spend.month, { confirmedUsd: 0.12, heldUsd: 0.05, unconfirmedUsd: 0.04 });

  // The spending panel adds up to exactly what the shared ceiling counts.
  db.exec(`CREATE TABLE catalog_research_spend (token TEXT PRIMARY KEY,utc_day TEXT NOT NULL,reserved_micro_usd INTEGER NOT NULL,
    charged_micro_usd INTEGER NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL,settled_at INTEGER)`);
  db.prepare("INSERT INTO catalog_research_spend VALUES ('r1','2026-09-20',200000,90000,'settled',0,0),('r2','2026-09-27',200000,200000,'uncertain',0,0)").run();
  const claude = collectClaudeSpendStatus(db, { env: { ANTHROPIC_MONTHLY_USD: "10" }, at: AT });
  assert.equal(Math.round(claude.totalUsd * 1_000_000), claudeMonthSpendMicroUsd(db, AT));
  assert.deepEqual(claude.research, { confirmedUsd: 0.09, heldUsd: 0, unconfirmedUsd: 0.2, totalUsd: 0.29 });
  assert.equal(claude.news.totalUsd, 0.21);
  assert.equal(claude.ceilingUsd, 10);
  assert.equal(claude.leftUsd, 9.5);
  assert.equal(claude.month, "2026-09");
});

test("a pass records why it stopped, including yielding and a paused publisher", async (t) => {
  const records = [];
  const record = (entry) => records.push(entry);
  const desk = { budgetLeft: () => 0.25, async ingest() { return 3; }, async publishPass() { return { confirmed: 1, published: 1, declined: 0, skippedForBudget: 0, picked: [{ headline: "Big news", signals: {} }], slot: "open" }; } };
  const logger = { log() {}, warn() {} };
  await runNewsDeskPass({ desk, coordinate: (job) => job(), memoryReady: () => true, record, now: () => AT, logger });
  assert.equal(records[0].reportsAdded, 3);
  assert.equal(records[0].result.published, 1);
  await runNewsDeskPass({ desk, coordinate: (job) => job(), memoryReady: () => false, record, now: () => AT, logger });
  assert.equal(records[1].reason, "yielded_for_memory");
  await runNewsDeskPass({ desk: { ...desk, publisherStatus: () => ({ ok: false, reason: "publisher_account_unavailable", message: "Review it." }) },
    coordinate: (job) => job(), memoryReady: () => true, record, now: () => AT, logger });
  assert.deepEqual(records[2], { at: AT, reason: "publisher_paused", publisherReason: "publisher_account_unavailable" });

  const db = database(t);
  recordNewsDeskPass(db, records[0]);
  const saved = collectNewsDeskStatus(db, { env: {}, at: AT }).lastPass;
  assert.deepEqual({ reason: saved.reason, headline: saved.headline }, { reason: "published", headline: "Big news" });
});

test("publisher hosts must resolve only to public addresses", async () => {
  for (const address of ["8.8.8.8", "151.101.1.1", "2606:4700::1111", "::ffff:8.8.8.8"]) assert.equal(publicAddress(address), true, address);
  for (const address of ["10.0.0.5", "127.0.0.1", "169.254.169.254", "100.64.1.1", "192.168.1.1", "::1", "fd00::1", "fe80::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::a00:1", "not an address"]) {
    assert.equal(publicAddress(address), false, address);
  }
  const answers = (list) => async () => list.map((address) => ({ address }));
  await assertPublicHost("www.nme.com", { resolve: answers(["151.101.1.1", "2a04:4e42::1"]) });
  await assert.rejects(assertPublicHost("www.nme.com", { resolve: answers(["151.101.1.1", "10.1.2.3"]) }), /public address/u,
    "one private answer is enough to refuse");
  await assert.rejects(assertPublicHost("www.nme.com", { resolve: answers([]) }), /public address/u);
});
