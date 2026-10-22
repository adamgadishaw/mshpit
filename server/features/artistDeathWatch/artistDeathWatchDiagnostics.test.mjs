import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { withArtistDeathWatchDiagnostics, formatArtistDeathWatchScanFailure } from "./artistDeathWatchDiagnostics.js";
import { startArtistDeathWatchScheduler } from "./artistDeathWatchScheduler.js";

test("actual SQLite failures retain error identity and expose only fixed operation and numeric codes", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE fixture(value TEXT UNIQUE); INSERT INTO fixture VALUES('private fixture')");
    const statement = db.prepare("INSERT INTO fixture VALUES(?)");
    let original;
    const repository = withArtistDeathWatchDiagnostics({
      saveConfirmedCandidate(value) {
        try { return statement.run(value); }
        catch (error) { original = error; throw error; }
      },
      transaction(work) { return work(); },
    });
    assert.throws(() => repository.transaction(() => repository.saveConfirmedCandidate("private fixture")), (error) => {
      assert.equal(error, original);
      assert.equal(error.code, "ERR_SQLITE_ERROR");
      assert.equal(error.errcode, 2067);
      assert.equal(formatArtistDeathWatchScanFailure(error),
        "[memorial-watch] bounded scan failed safely: code=ERR_SQLITE_ERROR status=0 operation=saveConfirmedCandidate sqliteCode=2067 sqlitePrimary=19");
      assert.doesNotMatch(formatArtistDeathWatchScanFailure(error), /private|fixture|INSERT|UNIQUE/);
      return true;
    });
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM fixture").get().n, 1);
  } finally { db.close(); }
});

test("untrusted operation labels, messages and invalid numeric codes never enter diagnostics", () => {
  const error = Object.assign(new Error("private SQL values"), {
    code: "ERR_SQLITE_ERROR", operation: "private identity", errcode: "2067 private",
  });
  assert.equal(formatArtistDeathWatchScanFailure(error),
    "[memorial-watch] bounded scan failed safely: code=ERR_SQLITE_ERROR status=0 operation=unknown sqliteCode=unknown");
  const provider = Object.assign(new Error("private upstream response"), { code: "wikidata_timeout" });
  assert.equal(formatArtistDeathWatchScanFailure(provider),
    "[memorial-watch] bounded scan failed safely: code=wikidata_timeout status=0");
});

test("scheduler contains a diagnosed database failure and retains its retry", async (t) => {
  const error = Object.assign(new Error("private SQL"), { code: "ERR_SQLITE_ERROR", errcode: 1 });
  const repository = withArtistDeathWatchDiagnostics({ readSettings() { throw error; } });
  const logs = [];
  t.mock.method(console, "error", (line) => logs.push(line));
  const timers = [];
  const scheduler = startArtistDeathWatchScheduler({
    service: { scan: () => repository.readSettings() },
    env: { RENDER: "true", ARTIST_DEATH_WATCH_SCHEDULER_ENABLED: "true" },
    setTimeoutImpl(callback, delay) { const timer = { callback, delay, unref() {} }; timers.push(timer); return timer; },
    clearTimeoutImpl() {},
  });
  timers[0].callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(logs, ["[memorial-watch] bounded scan failed safely: code=ERR_SQLITE_ERROR status=0 operation=readSettings sqliteCode=1 sqlitePrimary=1"]);
  assert.equal(timers.length, 2);
  assert.equal(timers[1].delay, 3_600_000);
  await scheduler.stop();
});
