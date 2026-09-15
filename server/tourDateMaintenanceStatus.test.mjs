import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { collectTourDateMaintenanceStatus, recordTourDateMaintenancePass, tourDateFailureLocation } from "./tourDateMaintenanceStatus.js";

const setup = (t) => { const db = new DatabaseSync(":memory:"); db.exec("CREATE TABLE app_meta(key TEXT PRIMARY KEY,value TEXT)"); t.after(() => db.close()); return db; };
test("tour maintenance stores bounded aggregates and a fixed application location, not exception content", (t) => {
  const db = setup(t), error = new TypeError("secret-key at https://provider.test/?apikey=secret");
  error.stack = "TypeError: secret-key\n    at persist (/opt/render/project/src/server/tourdates.js:1301:17)\n at secret (/private/member.db:1:2)";
  recordTourDateMaintenancePass(db, { state: "failed", stage: "artist_write", at: 200, startedAt: 100,
    category: "provider_refresh_failed", error });
  const status = collectTourDateMaintenanceStatus(db, { at: 300 });
  assert.equal(status.location, "server/tourdates.js:1301:17");
  assert.equal(status.stage, "artist_write");
  assert.equal(status.state, "failed");
  assert.doesNotMatch(JSON.stringify(status), /secret|provider.test|member.db/);
});
test("tour maintenance keeps one record and distinguishes a successful zero-row pass from no evidence", (t) => {
  const db = setup(t);
  assert.equal(collectTourDateMaintenanceStatus(db).state, "unverified");
  recordTourDateMaintenancePass(db, { state: "running", stage: "starting", at: 1 });
  recordTourDateMaintenancePass(db, { state: "succeeded", stage: "complete", at: 2, rows: 0, providerSuccesses: 3, providerFailures: 0 });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM app_meta").get().n, 1);
  const status = collectTourDateMaintenanceStatus(db, { at: 3 });
  assert.equal(status.state, "succeeded"); assert.equal(status.rows, 0);
});
test("tour diagnostics reject unknown paths and malformed persisted state", (t) => {
  const db = setup(t);
  assert.equal(tourDateFailureLocation({ stack: "at x (/server/credential.txt:1:2)" }), null);
  db.prepare("INSERT INTO app_meta VALUES (?,?)").run("tourdates:last-pass:v1", "{bad");
  assert.equal(collectTourDateMaintenanceStatus(db).state, "unverified");
});
