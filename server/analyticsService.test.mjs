import assert from "node:assert/strict";
import test from "node:test";

process.env.PIT_ALLOW_EMPTY_DB_BOOTSTRAP = "true";
const { db } = await import("./db.js");
const {
  ANALYTICS_MAX_RAW_ROWS,
  ANALYTICS_MAX_ROWS_PER_ACCOUNT,
  ANALYTICS_RETENTION_DAYS,
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

test("a rolled-back analytics write does not suppress the next retention prune", () => {
  const userId = "u_analytics_prune_rollback";
  const trigger = "analytics_prune_rollback_fail";
  const at = Date.now();
  const extras = JSON.stringify({ analyticsConsentAt: 1, termsAcceptedAt: 1, termsVersion: "2026-08" });
  db.exec("DROP TRIGGER IF EXISTS " + trigger);
  db.prepare("DELETE FROM events WHERE user_id=?").run(userId);
  db.prepare("DELETE FROM users WHERE id=?").run(userId);
  db.prepare("INSERT INTO users(id,email,name,handle,pass_hash,extras,created_at) VALUES(?,?,?,?,?,?,?)")
    .run(userId, "analytics-prune@example.test", "Analytics Prune", "analytics_prune", "test", extras, 1);
  db.prepare("INSERT INTO events(id,user_id,name,props,ip,created_at) VALUES(?,?,?,?,NULL,?)")
    .run("prune_rollback_old", userId, "screen_view", '{"screen":"tab_feed"}', at - ((ANALYTICS_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000));
  const currentUser = db.prepare("SELECT id,extras FROM users WHERE id=?").get(userId);
  resetAnalyticsServiceForTests();

  try {
    db.exec("CREATE TEMP TRIGGER " + trigger
      + " BEFORE INSERT ON events WHEN NEW.user_id='" + userId
      + "' BEGIN SELECT RAISE(ABORT, 'forced analytics insert failure'); END");
    assert.throws(() => ingestAnalyticsBatch({
      user: currentUser,
      at,
      requireIds: true,
      events: [{ id: "evt_prune_rollback", name: "screen_view", props: { screen: "tab_feed" } }],
    }), /forced analytics insert failure/);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM events WHERE id='prune_rollback_old'").get().count, 1,
      "the failed transaction restores the row pruned inside it");

    db.exec("DROP TRIGGER " + trigger);
    const recovered = ingestAnalyticsBatch({
      user: currentUser,
      at,
      requireIds: true,
      events: [{ id: "evt_prune_recovery", name: "screen_view", props: { screen: "tab_feed" } }],
    });
    assert.equal(recovered.stored, 1);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM events WHERE id='prune_rollback_old'").get().count, 0,
      "the same-time retry prunes again because the failed write never advanced the clock");
  } finally {
    db.exec("DROP TRIGGER IF EXISTS " + trigger);
    db.prepare("DELETE FROM events WHERE user_id=?").run(userId);
    db.prepare("DELETE FROM users WHERE id=?").run(userId);
  }
});

test("a request context captured before opt-out cannot insert after consent is revoked", () => {
  const userId = "u_analytics_stale_consent";
  const consentedExtras = JSON.stringify({ analyticsConsentAt: 1, termsAcceptedAt: 1, termsVersion: "2026-08" });
  db.prepare("DELETE FROM events WHERE user_id=?").run(userId);
  db.prepare("DELETE FROM users WHERE id=?").run(userId);
  db.prepare(`INSERT INTO users(id,email,name,handle,pass_hash,extras,created_at)
    VALUES(?,?,?,?,?,?,?)`).run(userId, "analytics-stale@example.test", "Analytics Stale", "analytics_stale", "test", consentedExtras, 1);

  // This is the same stale shape server/index.js can hold while awaiting the
  // request body. The account revokes consent before that request reaches the
  // synchronous analytics write path.
  const staleRequestUser = db.prepare("SELECT id,extras FROM users WHERE id=?").get(userId);
  db.prepare("UPDATE users SET extras=? WHERE id=?")
    .run(JSON.stringify({ analyticsOptOut: true, termsAcceptedAt: 1, termsVersion: "2026-08" }), userId);

  const result = ingestAnalyticsBatch({
    user: staleRequestUser,
    at: Date.now(),
    requireIds: true,
    events: [{ id: "evt_stale_consent", name: "screen_view", props: { screen: "tab_feed" } }],
  });

  assert.equal(result.stored, 0);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM events WHERE user_id=?").get(userId).count, 0);
  db.prepare("DELETE FROM users WHERE id=?").run(userId);
});
