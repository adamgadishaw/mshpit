import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const directory = mkdtempSync(join(tmpdir(), "pit-tour-completion-"));
process.env.PIT_DATA_DIR = directory;
process.env.TICKETMASTER_KEY = "fixture-only-no-live-credential";
process.env.BANDSINTOWN_APP_ID = "";
process.env.TOURDATE_REFRESH_ENABLED = "true";
process.env.TOURDATE_LIMIT = "1";
process.env.TOURDATE_ROTATION_SIZE = "0";
process.env.TOURDATE_COUNTRY_BATCH = "0";
process.env.TOURDATE_REQUEST_DELAY_MS = "500";
const { db } = await import("./db.js");
const { startTourDateScheduler, persistTourDateRefreshCompletion, TOURDATE_INGESTION_REVISION } = await import("./tourdates.js");
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

test("completion markers roll back together on a write failure and preserve enclosing transactions", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec("CREATE TABLE app_meta(key TEXT PRIMARY KEY,value TEXT)");
    persistTourDateRefreshCompletion(database, { at: 10, artistCursor: "old-cursor" });
    const markers = () => database.prepare("SELECT key,value FROM app_meta ORDER BY key").all();
    const before = markers();
    database.exec(`CREATE TRIGGER fixture_marker_failure BEFORE INSERT ON app_meta
      WHEN NEW.key='tourdates:ingestion-revision'
      BEGIN SELECT RAISE(ABORT,'fixture marker failure'); END;`);
    assert.throws(() => persistTourDateRefreshCompletion(database, { at: 20, artistCursor: "new-cursor" }), /fixture marker failure/);
    assert.deepEqual(markers(), before, "a later marker failure must roll back the already-written freshness time");
    assert.equal(database.isTransaction, false);
    database.exec("DROP TRIGGER fixture_marker_failure; BEGIN");
    persistTourDateRefreshCompletion(database, { at: 30, artistCursor: "outer-cursor" });
    assert.equal(database.isTransaction, true, "a savepoint release must not commit another caller's transaction");
    database.exec("ROLLBACK");
    assert.deepEqual(markers(), before);
  } finally { database.close(); }
});

test("a real native SQLite scheduled sweep persists its completion and does not replay successful provider work", async () => {
  const name = "Native SQLite Completion Fixture";
  db.prepare(`INSERT INTO artists(norm,name,public_slug,data,source,created_at,updated_at,popularity,rank_score)
    VALUES(?,?,?,'{}','test',1,1,1000000000000,1000000000000)`)
    .run(name.toLowerCase(), name, "native-sqlite-completion-fixture");
  assert.equal(typeof db.transaction, "undefined", "test the actual Node SQLite API, not a better-sqlite3 mock");
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  let scheduled;
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    assert.equal(url.origin, "https://app.ticketmaster.com");
    assert.equal(url.searchParams.get("keyword"), name);
    providerCalls += 1;
    return new Response(JSON.stringify({ _embedded: { events: [{
      id: "native-sqlite-completion", name,
      classifications: [{ segment: { name: "Music" } }],
      dates: { start: { localDate: "2035-09-30", dateTime: "2035-09-30T23:00:00Z" } },
      _embedded: { attractions: [{ name }], venues: [{ id: "native-sqlite-hall", name: "Completion Hall",
        city: { name: "Toronto" }, country: { name: "Canada", countryCode: "CA" },
        address: { line1: "100 Fixture Street" } }] },
    }] } }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    startTourDateScheduler({ logger: { log() {} }, schedule(options) { scheduled = options; return { stop() {} }; } });
    assert.equal(typeof scheduled?.run, "function");
    const startedAt = Date.now();
    await scheduled.run();
    const marker = db.prepare("SELECT value FROM app_meta WHERE key='tourdates:last-refresh:v1'").get();
    assert.ok(Number(marker?.value) >= startedAt, "successful data writes must also commit the freshness marker");
    assert.equal(db.prepare("SELECT value FROM app_meta WHERE key='tourdates:ingestion-revision'").get()?.value,
      TOURDATE_INGESTION_REVISION);
    assert.equal(db.prepare("SELECT value FROM app_meta WHERE key='tourdates:artist-cursor:v1'").get()?.value, "");
    assert.equal(db.prepare("SELECT venue FROM tour_dates WHERE id='tm_native-sqlite-completion'").get()?.venue, "Completion Hall");
    assert.equal(providerCalls, 1);
    await scheduled.run();
    assert.equal(providerCalls, 1, "a fresh completed sweep cannot rerun after another scheduled trigger");
  } finally { globalThis.fetch = originalFetch; }
});
