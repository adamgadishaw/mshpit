import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMusicBrainzCooldownStore, MUSICBRAINZ_COOLDOWN_KEY } from "./musicBrainzCooldownStore.js";
import { createMusicBrainzRequestThrottle } from "./musicBrainzRequestThrottle.js";
import { PROVIDER_RETRY_AFTER_MAX_MS } from "./providerResponsePolicy.js";

const AT = Date.UTC(2026, 9, 9, 12);

function fixture(t) {
  const database = new DatabaseSync(":memory:");
  database.exec("CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  t.after(() => database.close());
  return { database, store: createMusicBrainzCooldownStore(database) };
}

test("cooldown storage never creates startup state and atomically retains the later deadline", (t) => {
  const { database, store } = fixture(t);
  assert.equal(store.readDeadline(AT), 0);
  assert.equal(database.prepare("SELECT count(*) n FROM app_meta").get().n, 0);
  assert.equal(store.extendDeadline(AT + 7_200_000, AT), AT + 7_200_000);
  const second = createMusicBrainzCooldownStore(database);
  assert.equal(second.extendDeadline(AT + 60_000, AT), AT + 7_200_000);
  assert.equal(second.extendDeadline(AT + 10_800_000, AT), AT + 10_800_000);
  assert.equal(store.readDeadline(AT), AT + 10_800_000);
  assert.equal(database.prepare("SELECT count(*) n FROM app_meta").get().n, 1);
});

test("invalid stored deadlines cannot pin requests forever or prevent a later valid write", (t) => {
  const { database, store } = fixture(t);
  const write = database.prepare("INSERT OR REPLACE INTO app_meta (key,value) VALUES (?,?)");
  for (const value of ["", "-1", "Infinity", "NaN", "1e99", "123bad", "{}", "9007199254740992", String(AT + 2 * PROVIDER_RETRY_AFTER_MAX_MS)]) {
    write.run(MUSICBRAINZ_COOLDOWN_KEY, value);
    assert.equal(store.readDeadline(AT), 0, value);
    assert.equal(store.extendDeadline(AT + 60_000, AT), AT + 60_000, value);
  }
  assert.equal(store.extendDeadline(Number.MAX_SAFE_INTEGER, AT), AT + PROVIDER_RETRY_AFTER_MAX_MS);
  for (const value of [NaN, Infinity, -1, AT, AT + 0.5]) {
    assert.throws(() => store.extendDeadline(value, AT), TypeError);
  }
});

test("a new database connection and gate honor the remaining provider wait after restart", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pit-mb-cooldown-"));
  const path = join(directory, "fixture.db");
  let database = new DatabaseSync(path);
  t.after(() => { database.close(); rmSync(directory, { recursive: true, force: true }); });
  database.exec("CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  let now = AT;
  const options = () => ({ clock: () => now, wait: async (ms) => { now += ms; }, cooldownStore: createMusicBrainzCooldownStore(database) });
  const beforeRestart = createMusicBrainzRequestThrottle(options());
  const retryAt = now + 7_200_000;
  await assert.rejects(beforeRestart(async () => { throw Object.assign(new Error("synthetic upstream"), { status: 503, retryAt }); }), { status: 503 });
  database.close();
  database = new DatabaseSync(path);
  now += 3_600_000;
  const afterRestart = createMusicBrainzRequestThrottle(options());
  let outbound = 0;
  await assert.rejects(afterRestart(async () => { outbound += 1; }), (error) => error.code === "circuit_open" && error.retryAt === retryAt && error.retryAfterMs === 3_600_000);
  assert.equal(outbound, 0);
  now = retryAt;
  await afterRestart(async () => { outbound += 1; });
  assert.equal(outbound, 1);
  assert.equal(afterRestart.status().circuitOpen, false);
  assert.equal(database.prepare("SELECT value FROM app_meta WHERE key=?").get(MUSICBRAINZ_COOLDOWN_KEY).value, String(retryAt), "success never erases a newer process's potential wait");
  await assert.rejects(afterRestart(async () => { throw Object.assign(new Error("one transient"), { status: 503 }); }), { status: 503 });
  assert.equal(afterRestart.status().circuitOpen, false, "an expired persisted row must not leave every later request half-open");
});

test("SQLite read failure blocks outbound while a write failure preserves provider error and local wait", async (t) => {
  const { database, store } = fixture(t);
  const failures = [];
  const gate = createMusicBrainzRequestThrottle({ clock: () => AT, cooldownStore: store, onCooldownPersistenceError: (operation) => failures.push(operation) });
  database.exec("CREATE TRIGGER deny_cooldown BEFORE INSERT ON app_meta BEGIN SELECT RAISE(FAIL, 'test storage unavailable'); END");
  const original = Object.assign(new Error("provider response"), { status: 429, retryAt: AT + 7_200_000 });
  await assert.rejects(gate(async () => { throw original; }), (error) => error === original);
  assert.equal(gate.status().cooldownPersistenceError, "write");
  await assert.rejects(gate(async () => assert.fail("must remain paused")), { code: "circuit_open" });
  assert.deepEqual(failures, ["write"]);
  database.exec("DROP TABLE app_meta");
  await assert.rejects(gate(async () => assert.fail("must fail closed")), { code: "cooldown_state_unavailable" });
  assert.equal(gate.status().cooldownPersistenceError, "read");
  assert.deepEqual(failures, ["write", "read"], "status polling must not flood diagnostics");
});

test("a restart after the stored wait expires restores one recovery probe without repeating it after success", async (t) => {
  const { store } = fixture(t);
  store.extendDeadline(AT + 60_000, AT);
  let now = AT + 120_000, outbound = 0;
  const gate = createMusicBrainzRequestThrottle({
    clock: () => now,
    wait: async (ms) => { now += ms; },
    cooldownStore: store,
  });
  const fail = async () => {
    outbound += 1;
    throw Object.assign(new Error("synthetic upstream"), { status: 503 });
  };
  await assert.rejects(gate(fail), { status: 503 });
  assert.equal(outbound, 1);
  assert.equal(gate.status().circuitOpen, true, "the first request after restart must be a recovery probe");
  await assert.rejects(gate(fail), { code: "circuit_open" });
  assert.equal(outbound, 1, "one failed probe blocks a second outbound request");
  now = gate.status().retryAt;
  await gate(async () => { outbound += 1; });
  assert.equal(outbound, 2);
  assert.equal(gate.status().circuitOpen, false);
  await assert.rejects(gate(fail), { status: 503 });
  assert.equal(outbound, 3);
  assert.equal(gate.status().circuitOpen, false, "a healthy probe acknowledges that durable deadline once");
  assert.equal(gate.status().consecutiveFailures, 1);
});
