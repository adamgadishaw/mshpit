import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { admitClaudeSpend, anthropicMonthlyCeilingMicroUsd, claudeMonthSpendMicroUsd, claudeRequestDefinitelyRejected } from "./claudeSpendCeiling.js";

test("the approved shared allowance preserves explicit zero and lower operator limits", () => {
  assert.equal(anthropicMonthlyCeilingMicroUsd({}), 20_000_000);
  assert.equal(anthropicMonthlyCeilingMicroUsd({ ANTHROPIC_MONTHLY_USD: "0" }), 0);
  assert.equal(anthropicMonthlyCeilingMicroUsd({ ANTHROPIC_MONTHLY_USD: "10" }), 10_000_000);
  assert.equal(anthropicMonthlyCeilingMicroUsd({ ANTHROPIC_MONTHLY_USD: "invalid" }), 20_000_000);
});

test("shared admission rechecks each feature's receipt and rolls back a failed reservation", (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec("CREATE TABLE news_desk_receipts(day TEXT,charged_usd REAL)");
  const at = Date.parse("2026-09-27T12:00:00Z");
  const options = { env: { ANTHROPIC_MONTHLY_USD: "0.30" }, at, reserveMicroUsd: 200_000,
    dailyCapMicroUsd: 500_000, monthlyCapMicroUsd: 6_000_000,
    readDailySpendMicroUsd: () => 0, readMonthlySpendMicroUsd: () => 0,
    reserve: () => { db.prepare("INSERT INTO news_desk_receipts VALUES ('2026-09-27',0.2)").run(); return "receipt"; },
  };
  assert.deepEqual(admitClaudeSpend(db, options), { ok: true, value: "receipt" });
  assert.deepEqual(admitClaudeSpend(db, options), { ok: false, reason: "claude_monthly_ceiling" });
  assert.equal(claudeMonthSpendMicroUsd(db, at), 200_000);
  assert.throws(() => admitClaudeSpend(db, { ...options, reserveMicroUsd: 50_000, reserve: () => {
    db.prepare("INSERT INTO news_desk_receipts VALUES ('2026-09-27',0.05)").run(); throw new Error("disk failure fixture");
  } }), /disk failure/);
  assert.equal(claudeMonthSpendMicroUsd(db, at), 200_000);
  assert.deepEqual(admitClaudeSpend(db, { ...options, dailyCapMicroUsd: 100_000 }), { ok: false, reason: "daily_budget" });
  assert.deepEqual(admitClaudeSpend(db, { ...options, monthlyCapMicroUsd: 100_000 }), { ok: false, reason: "monthly_budget" });
  assert.throws(() => admitClaudeSpend(db, { ...options, reserveMicroUsd: NaN }), /Invalid/);
});

test("only explicit non-admitted responses release uncertain Claude reservations", () => {
  for (const status of [400, 401, 403, 404, 422, 429]) assert.equal(claudeRequestDefinitelyRejected({ status }), true);
  for (const status of [undefined, 0, 200, 408, 500, 503, 529]) assert.equal(claudeRequestDefinitelyRejected({ status }), false);
});
