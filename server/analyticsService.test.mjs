import assert from "node:assert/strict";
import test from "node:test";

process.env.PIT_ALLOW_EMPTY_DB_BOOTSTRAP = "true";
const { db } = await import("./db.js");
const {
  ANALYTICS_MAX_RAW_ROWS,
  ANALYTICS_MAX_ROWS_PER_ACCOUNT,
  ingestAnalyticsBatch,
  resetAnalyticsServiceForTests,
} = await import("./analyticsService.js");

const user = { id: "u_analytics_cap", extras: JSON.stringify({ consentAt: 1, termsVersion: "2026-07" }) };

test("analytics insertion enforces the raw row ceiling in the same transaction", () => {
  const at = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM events").run();
    db.prepare(`INSERT OR IGNORE INTO users(id,email,name,handle,pass_hash,extras,created_at)
      VALUES(?,?,?,?,?,?,?)`).run(user.id, "analytics-cap@example.test", "Analytics Cap", "analytics_cap", "test", user.extras, 1);
    const insert = db.prepare("INSERT INTO events(id,user_id,name,props,ip,created_at) VALUES(?,?,?,?,NULL,?)");
    for (let index = 0; index < ANALYTICS_MAX_RAW_ROWS - 1; index++) {
      insert.run(`cap_old_${index}`, user.id, "screen_view", '{"screen":"tab_feed"}', at - 1);
    }
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }

  resetAnalyticsServiceForTests();
  const result = ingestAnalyticsBatch({
    user,
    at,
    requireIds: true,
    events: Array.from({ length: 40 }, (_, index) => ({
      id: `evt_cap_${String(index).padStart(4, "0")}`,
      name: "screen_view",
      props: { screen: "tab_feed" },
    })),
  });
  assert.equal(result.stored, 40);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM events").get().count, ANALYTICS_MAX_ROWS_PER_ACCOUNT);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM events WHERE created_at=?").get(at).count, 40);
  db.prepare("DELETE FROM events WHERE user_id=?").run(user.id);
});
