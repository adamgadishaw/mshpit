import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import test from "node:test";
import { backupStorageIdentity } from "./backupStorageIdentity.js";
import { RESTORE_GATE_KEY } from "./databaseRecovery.js";
import {
  PRIVACY_REPLAY_EVIDENCE_KEY, ensurePrivacyJournalSchema, privacyJournalStatus,
  privacyObjectKey, recordPrivacyEvent, replayPrivacyJournalIfRestored,
  restoredDatabaseNeedsReplay, shipPrivacyJournal, signPrivacyEntry, verifyPrivacyEntry,
} from "./privacyJournal.js";
import {
  CONTINUITY_KEY, COVERAGE_OBJECT, EMPTY_HEAD, privacyEntryHead, readContinuity,
  signCoverage, verifyCoverage, verifyContinuityChain, writeContinuity,
} from "./privacyJournalContinuity.js";

const AT = Date.parse("2026-09-27T20:00:00Z");
const DAY = 86_400_000;
const KEY_TEXT = "synthetic-journal-test-key-".repeat(2);
const KEY = Buffer.from(KEY_TEXT);
const ENV_A = {
  PRIVACY_JOURNAL_KEY: KEY_TEXT,
  BACKUP_S3_ENDPOINT: "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
  BACKUP_S3_BUCKET: "synthetic-backup-a",
  BACKUP_S3_ACCESS_KEY_ID: "synthetic-access",
  BACKUP_S3_SECRET_ACCESS_KEY: "synthetic-secret",
};
const ENV_B = { ...ENV_A, BACKUP_S3_BUCKET: "synthetic-backup-b" };

test("a restored snapshot predating the outbox cannot bootstrap trusted empty coverage", async (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec("CREATE TABLE app_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE users(id TEXT PRIMARY KEY,opted_out INTEGER DEFAULT 0)");
  db.prepare("INSERT INTO users(id) VALUES (?)").run("u_legacy_restored");
  gate(db);
  ensurePrivacyJournalSchema(db);
  assert.equal(readContinuity(db).legacyUnknown, true);
  const store = storage();
  await shipPrivacyJournal(db, { env: ENV_A, fetchImpl: store.fetchImpl, now: () => AT + 150 });
  await assert.rejects(replay(db, store), { code: "PRIVACY_JOURNAL_REPLAY_REQUIRED" });
  assert.ok(restoredDatabaseNeedsReplay(db, ENV_A));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users").get().n, 1);
});

function database(t, { legacy = false } = {}) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec("CREATE TABLE app_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
  if (legacy) db.exec(`CREATE TABLE privacy_journal_outbox (
    id TEXT PRIMARY KEY,kind TEXT NOT NULL,subject_id TEXT NOT NULL,at INTEGER NOT NULL,
    shipped_at INTEGER,attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT)`);
  ensurePrivacyJournalSchema(db);
  return db;
}

// Every request terminates in this in-memory S3 model; no transport is used.
function storage(env = ENV_A) {
  const objects = new Map();
  const calls = [];
  let fault = null;
  const etag = (key) => `"${createHash("sha256").update(objects.get(key)).digest("hex")}"`;
  const fetchImpl = async (url, init = {}) => {
    const target = new URL(url);
    const signed = target.searchParams.has("X-Amz-Signature");
    const key = decodeURIComponent(target.pathname.slice(`/${env.BACKUP_S3_BUCKET}/`.length));
    const call = { key, method: init.method || "GET", signed, init };
    calls.push(call);
    assert.equal(target.hostname, new URL(env.BACKUP_S3_ENDPOINT).hostname);
    assert.ok(target.pathname === `/${env.BACKUP_S3_BUCKET}` || target.pathname.startsWith(`/${env.BACKUP_S3_BUCKET}/`));
    if (!signed) return new Response("", { status: 403 });
    const injected = await fault?.(call);
    if (injected) return injected;
    if (call.method === "PUT") {
      if (new Headers(init.headers).get("If-None-Match") === "*" && objects.has(key)) return new Response("", { status: 412 });
      const expected = new Headers(init.headers).get("If-Match");
      if (expected && (!objects.has(key) || expected !== etag(key))) return new Response("", { status: 412 });
      objects.set(key, init.body);
      return new Response("", { status: 200 });
    }
    if (target.searchParams.has("list-type")) {
      const names = [...objects.keys()].filter((name) => name.startsWith(target.searchParams.get("prefix"))).sort();
      const start = Number(target.searchParams.get("continuation-token") || 0);
      const page = names.slice(start, start + 2);
      const more = start + page.length < names.length;
      return new Response(`<ListBucketResult>${page.map((name) => `<Contents><Key>${name}</Key></Contents>`).join("")}<IsTruncated>${more}</IsTruncated>${more ? `<NextContinuationToken>${start + page.length}</NextContinuationToken>` : ""}</ListBucketResult>`);
    }
    return objects.has(key) ? new Response(objects.get(key), { headers: { ETag: etag(key) } }) : new Response("", { status: 404 });
  };
  return { objects, calls, fetchImpl, setFault: (value) => { fault = value; } };
}

const rowCount = (db) => db.prepare("SELECT COUNT(*) AS n FROM privacy_journal_outbox").get().n;
const receipt = (db) => db.prepare("SELECT value FROM app_meta WHERE key=?").get(PRIVACY_REPLAY_EVIDENCE_KEY);
const anchor = (db) => { const { lastError, ...value } = readContinuity(db); return value; };
const gate = (db) => db.prepare("INSERT INTO app_meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
  .run(RESTORE_GATE_KEY, JSON.stringify({ version: 1, state: "reviewed", preparedAt: AT + 100 }));
const eventObjects = (store) => [...store.objects.entries()].filter(([key]) => key.startsWith("privacy-journal/v1/"))
  .map(([key, body]) => ({ key, entry: JSON.parse(body) })).sort((a, b) => a.entry.sequence - b.entry.sequence);
const copyObjects = (source, destination) => { for (const [key, body] of source.objects) destination.objects.set(key, body); };
const replay = (db, store, env = ENV_A) => replayPrivacyJournalIfRestored(db, {
  env, fetchImpl: store.fetchImpl, now: () => AT + 200,
  erase: (id) => db.prepare("DELETE FROM users WHERE id=?").run(id).changes > 0,
  optOut: (id) => db.prepare("UPDATE users SET opted_out=1 WHERE id=? AND opted_out=0").run(id).changes > 0,
});

async function fixture(t, { retainSnapshots = false } = {}) {
  const db = database(t);
  db.exec("CREATE TABLE users(id TEXT PRIMARY KEY,opted_out INTEGER NOT NULL DEFAULT 0)");
  for (const id of ["u_erased_first", "u_opted_out", "u_erased_last", "u_kept"]) db.prepare("INSERT INTO users(id) VALUES (?)").run(id);
  const store = storage();
  const snapshots = [];
  const directory = retainSnapshots ? mkdtempSync(join(tmpdir(), "pit-continuity-snapshots-")) : null;
  if (directory) t.after(() => rmSync(directory, { recursive: true, force: true }));
  const retain = async () => {
    if (!directory) return;
    const path = join(directory, `snapshot-${snapshots.length}.sqlite`);
    await backup(db, path);
    snapshots.push(path);
  };
  assert.equal((await shipPrivacyJournal(db, { env: ENV_A, fetchImpl: store.fetchImpl, now: () => AT })).error, undefined);
  await retain();
  for (const [index, [kind, subjectId]] of [["account_erased", "u_erased_first"], ["marketing_opt_out", "u_opted_out"], ["account_erased", "u_erased_last"]].entries()) {
    db.exec("BEGIN");
    if (kind === "account_erased") db.prepare("DELETE FROM users WHERE id=?").run(subjectId);
    else db.prepare("UPDATE users SET opted_out=1 WHERE id=?").run(subjectId);
    recordPrivacyEvent(db, { id: `00000000-0000-4000-8000-00000000000${index + 1}`, kind, subjectId, at: AT + index + 1 });
    db.exec("COMMIT");
    await retain(); // Includes a snapshot whose newest event is not shipped yet.
    assert.equal((await shipPrivacyJournal(db, { env: ENV_A, fetchImpl: store.fetchImpl, now: () => AT + 10 + index })).error, undefined);
  }
  await retain();
  // Age confirmed local rows, then prove the remote chain permits their pruning.
  db.prepare("UPDATE privacy_journal_outbox SET shipped_at=?").run(AT - 31 * DAY);
  recordPrivacyEvent(db, { id: "00000000-0000-4000-8000-000000000004", kind: "marketing_opt_out", subjectId: "u_opted_out", at: AT + 20 });
  assert.equal((await shipPrivacyJournal(db, { env: ENV_A, fetchImpl: store.fetchImpl, now: () => AT + 30 })).error, undefined);
  assert.equal(rowCount(db), 1, "confirmed old rows are pruned while their chain anchor remains durable");
  await retain();
  return { db, store, snapshots };
}

test("v2 entry signatures bind the stream, sequence and previous head", (t) => {
  const db = database(t);
  recordPrivacyEvent(db, { kind: "account_erased", subjectId: "u_bound", at: AT });
  const plain = JSON.parse(db.prepare("SELECT entry_json FROM privacy_journal_outbox").get().entry_json);
  const signed = signPrivacyEntry(plain, KEY);
  assert.equal(signed.v, 2);
  assert.equal(verifyPrivacyEntry(signed, KEY), true);
  for (const changed of [{ streamId: "00000000-0000-4000-8000-000000000001" }, { sequence: 2 }, { previous: "f".repeat(64) }]) {
    assert.equal(verifyPrivacyEntry({ ...signed, ...changed }, KEY), false);
  }
  assert.equal(readContinuity(db).head, privacyEntryHead(signed));
  assert.equal(plain.sequence, 1);
  assert.equal(plain.previous, EMPTY_HEAD);
});

test("an empty replacement destination cannot inherit readiness after local history is pruned", async (t) => {
  const { db } = await fixture(t);
  const replacement = storage(ENV_B);
  const before = anchor(db);
  const result = await shipPrivacyJournal(db, { env: ENV_B, fetchImpl: replacement.fetchImpl });
  assert.deepEqual(result, { shipped: 0, pending: 1, waiting: "continuity", error: "continuity_unknown" });
  assert.deepEqual(anchor(db), before);
  assert.equal(readContinuity(db).lastError, "continuity_unknown");
  assert.equal(replacement.calls.some((call) => call.method === "PUT"), false);
  assert.equal(privacyJournalStatus(db, ENV_B).continuityReady, false);
  db.exec("DELETE FROM privacy_journal_outbox WHERE shipped_at IS NOT NULL");
  assert.deepEqual(await shipPrivacyJournal(db, { env: ENV_B, fetchImpl: replacement.fetchImpl }),
    { shipped: 0, pending: 0, waiting: "continuity", error: "continuity_unknown" }, "zero local rows cannot prove remote continuity");
  gate(db);
  await assert.rejects(replay(db, replacement, ENV_B), { code: "PRIVACY_JOURNAL_REPLAY_REQUIRED" });
  assert.equal(receipt(db), undefined);
});

test("a complete copied chain migrates and replays every retained SQLite snapshot anchor", async (t) => {
  const { db, store, snapshots } = await fixture(t, { retainSnapshots: true });
  const replacement = storage(ENV_B);
  copyObjects(store, replacement);
  assert.equal((await shipPrivacyJournal(db, { env: ENV_B, fetchImpl: replacement.fetchImpl, now: () => AT + 40 })).error, undefined);
  const checkpoint = JSON.parse(replacement.objects.get(COVERAGE_OBJECT));
  assert.equal(checkpoint.storageIdentity, backupStorageIdentity(ENV_B));
  assert.equal(verifyCoverage(checkpoint, KEY), true);
  assert.equal(privacyJournalStatus(db, ENV_B).continuityReady, true);
  assert.equal(snapshots.length, 6);
  for (const path of snapshots) {
    const restored = new DatabaseSync(path);
    try {
      gate(restored);
      const result = await replay(restored, replacement, ENV_B);
      assert.equal(result.continuityVerified, true);
      assert.equal(result.verified, 4);
      assert.equal(result.storageIdentity, backupStorageIdentity(ENV_B));
      assert.equal(restored.prepare("SELECT COUNT(*) AS n FROM users WHERE id LIKE 'u_erased_%'").get().n, 0);
      assert.equal(restored.prepare("SELECT opted_out FROM users WHERE id='u_opted_out'").get().opted_out, 1);
      assert.equal(restored.prepare("SELECT opted_out FROM users WHERE id='u_kept'").get().opted_out, 0);
      assert.equal(restoredDatabaseNeedsReplay(restored, ENV_B), null);
      assert.ok(restoredDatabaseNeedsReplay(restored, ENV_A), "a replay receipt cannot authorize a different destination");
    } finally { restored.close(); }
  }
});

test("missing or unverifiable recovery evidence fails before any privacy mutation", async (t) => {
  const mutations = [
    ["missing middle", (store) => store.objects.delete(eventObjects(store)[1].key)],
    ["missing tail", (store) => store.objects.delete(eventObjects(store).at(-1).key)],
    ["missing checkpoint", (store) => store.objects.delete(COVERAGE_OBJECT)],
    ["wrong event signature", (store) => {
      const { key, entry } = eventObjects(store)[1];
      store.objects.set(key, JSON.stringify(signPrivacyEntry(entry, Buffer.from("wrong-key".repeat(6)))));
    }],
    ["valid signature over a broken link", (store) => {
      const { key, entry } = eventObjects(store)[1];
      store.objects.set(key, JSON.stringify(signPrivacyEntry({ ...entry, previous: EMPTY_HEAD }, KEY)));
    }],
    ["wrong checkpoint signature", (store) => {
      store.objects.set(COVERAGE_OBJECT, JSON.stringify(signCoverage(JSON.parse(store.objects.get(COVERAGE_OBJECT)), Buffer.from("wrong-key".repeat(6)))));
    }],
    ["different stream", (store) => {
      store.objects.set(COVERAGE_OBJECT, JSON.stringify(signCoverage({ ...JSON.parse(store.objects.get(COVERAGE_OBJECT)), streamId: "00000000-0000-4000-8000-000000000099" }, KEY)));
    }],
    ["wrong destination checkpoint", (store) => {
      store.objects.set(COVERAGE_OBJECT, JSON.stringify(signCoverage({ ...JSON.parse(store.objects.get(COVERAGE_OBJECT)), storageIdentity: backupStorageIdentity(ENV_B) }, KEY)));
    }],
    ["missing signing key", () => {}, { ...ENV_A, PRIVACY_JOURNAL_KEY: "" }],
  ];
  for (const [name, corrupt, env = ENV_A] of mutations) await t.test(name, async (t) => {
    const { db, store } = await fixture(t);
    corrupt(store);
    if (name !== "wrong destination checkpoint") {
      const replacement = storage(ENV_B);
      copyObjects(store, replacement);
      const before = anchor(db);
      const migration = await shipPrivacyJournal(db, { env: { ...ENV_B, PRIVACY_JOURNAL_KEY: env.PRIVACY_JOURNAL_KEY }, fetchImpl: replacement.fetchImpl });
      assert.equal(migration.shipped, 0, "migration cannot mark rows against incomplete evidence");
      assert.equal(migration.waiting, name === "missing signing key" ? "key" : "continuity");
      assert.equal(replacement.calls.some((call) => call.method === "PUT"), false);
      assert.deepEqual(anchor(db), before);
    }
    gate(db);
    let changed = 0;
    await assert.rejects(replayPrivacyJournalIfRestored(db, { env, fetchImpl: store.fetchImpl,
      erase: () => { changed += 1; }, optOut: () => { changed += 1; } }), { code: "PRIVACY_JOURNAL_REPLAY_REQUIRED" });
    assert.equal(changed, 0);
    assert.equal(receipt(db), undefined);
    assert.ok(restoredDatabaseNeedsReplay(db, env));
  });
});

test("a zero-event journal requires a signed checkpoint for the same fresh stream", async (t) => {
  const db = database(t);
  const store = storage();
  gate(db);
  await assert.rejects(replay(db, store), { code: "PRIVACY_JOURNAL_REPLAY_REQUIRED" });
  const state = readContinuity(db);
  const checkpoint = signCoverage({ storageIdentity: backupStorageIdentity(ENV_A), streamId: state.streamId,
    sequence: 0, head: EMPTY_HEAD, legacyUnknown: false, at: AT }, KEY);
  store.objects.set(COVERAGE_OBJECT, JSON.stringify(signCoverage({ ...checkpoint, streamId: "00000000-0000-4000-8000-000000000001" }, KEY)));
  await assert.rejects(replay(db, store), { code: "PRIVACY_JOURNAL_REPLAY_REQUIRED" });
  store.objects.set(COVERAGE_OBJECT, JSON.stringify(checkpoint));
  db.prepare("DELETE FROM app_meta WHERE key=?").run(CONTINUITY_KEY);
  await assert.rejects(replay(db, store), { code: "PRIVACY_JOURNAL_REPLAY_REQUIRED" });
  writeContinuity(db, state);
  assert.equal((await replay(db, store)).verified, 0);
  assert.equal(restoredDatabaseNeedsReplay(db, ENV_A), null);
});

test("legacy history remains unproven, unpruned, and requires an explicit restore waiver", async (t) => {
  const db = database(t, { legacy: true });
  const store = storage();
  db.prepare("INSERT INTO privacy_journal_outbox(id,kind,subject_id,at) VALUES (?,?,?,?)")
    .run("legacy-event-0001", "account_erased", "u_legacy", AT - 60 * DAY);
  assert.equal(readContinuity(db).legacyUnknown, true);
  assert.equal((await shipPrivacyJournal(db, { env: ENV_A, fetchImpl: store.fetchImpl, now: () => AT - 31 * DAY })).shipped, 1);
  recordPrivacyEvent(db, { kind: "marketing_opt_out", subjectId: "u_legacy", at: AT });
  await shipPrivacyJournal(db, { env: ENV_A, fetchImpl: store.fetchImpl, now: () => AT });
  assert.equal(rowCount(db), 2, "unproven legacy evidence must not expire locally");
  assert.equal(privacyJournalStatus(db, ENV_A).continuityReady, false);
  gate(db);
  await assert.rejects(replay(db, store), { code: "PRIVACY_JOURNAL_REPLAY_REQUIRED" });
  const waived = await replay(db, store, { ...ENV_A, PRIVACY_JOURNAL_REPLAY_WAIVER: "incident/legacy-review" });
  assert.equal(waived.waived, "incident/legacy-review");
  assert.equal(waived.reason, "PRIVACY_JOURNAL_CONTINUITY_UNKNOWN");
  assert.equal(restoredDatabaseNeedsReplay(db, ENV_B), null, "the existing explicit owner waiver survives destination changes");
});

test("failed or aborted checkpoint confirmation never marks pending rows or prunes old history", async (t) => {
  for (const mode of ["put failure", "read failure", "wrong readback", "abort during readback"]) await t.test(mode, async (t) => {
    const { db, store } = await fixture(t);
    db.prepare("UPDATE privacy_journal_outbox SET shipped_at=?").run(AT - 31 * DAY);
    recordPrivacyEvent(db, { id: "00000000-0000-4000-8000-000000000005", kind: "account_erased", subjectId: "u_new", at: AT + 50 });
    const before = anchor(db);
    const controller = new AbortController();
    let checkpointPut = false;
    store.setFault(({ key, method }) => {
      if (key !== COVERAGE_OBJECT) return null;
      if (method === "PUT") {
        checkpointPut = true;
        if (mode === "put failure") return new Response("", { status: 503 });
      }
      if (method === "GET" && checkpointPut) {
        if (mode === "read failure") return new Response("", { status: 503 });
        if (mode === "wrong readback") return new Response(JSON.stringify(signCoverage({ ...JSON.parse(store.objects.get(key)), at: AT - 1 }, KEY)), { headers: { ETag: '"wrong-readback"' } });
        if (mode === "abort during readback") { controller.abort(new Error("synthetic shutdown")); throw controller.signal.reason; }
      }
      return null;
    });
    const operation = shipPrivacyJournal(db, { env: ENV_A, fetchImpl: store.fetchImpl, now: () => AT + 60, signal: controller.signal });
    if (mode === "abort during readback") await assert.rejects(operation, /synthetic shutdown/u);
    else assert.equal((await operation).error, "coverage_unconfirmed");
    assert.equal(checkpointPut, true);
    assert.deepEqual(anchor(db), before);
    assert.equal(readContinuity(db).lastError, mode === "abort during readback" ? null : "coverage_unconfirmed");
    assert.equal(rowCount(db), 2);
    assert.equal(db.prepare("SELECT shipped_at FROM privacy_journal_outbox WHERE id=?").get("00000000-0000-4000-8000-000000000005").shipped_at, null);
  });
});

test("snapshot anchors cannot accept a shorter or conflicting signed chain", (t) => {
  const db = database(t);
  const entries = [];
  for (let index = 0; index < 3; index += 1) {
    recordPrivacyEvent(db, { id: `snapshot-event-${index}`, kind: "account_erased", subjectId: `u_${index}`, at: AT + index });
    entries.push(signPrivacyEntry(JSON.parse(db.prepare("SELECT entry_json FROM privacy_journal_outbox WHERE id=?").get(`snapshot-event-${index}`).entry_json), KEY));
  }
  const anchor = readContinuity(db);
  const coverage = signCoverage({ ...anchor, storageIdentity: backupStorageIdentity(ENV_A), at: AT }, KEY);
  assert.equal(verifyContinuityChain(entries, coverage, anchor), true);
  assert.equal(verifyContinuityChain(entries.slice(0, 2), { ...coverage, sequence: 2, head: privacyEntryHead(entries[1]) }, anchor), false);
  assert.equal(verifyContinuityChain(entries, coverage, { ...anchor, head: "f".repeat(64) }), false);
  writeContinuity(db, { ...anchor, head: "invalid" });
  assert.equal(readContinuity(db), null);
  assert.throws(() => recordPrivacyEvent(db, { kind: "account_erased", subjectId: "u_refused", at: AT }), { code: "PRIVACY_JOURNAL_CONTINUITY_UNKNOWN" });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM privacy_journal_outbox").get().n, 3);
  assert.ok(db.prepare("SELECT value FROM app_meta WHERE key=?").get(CONTINUITY_KEY));
});

test("interrupted destination migration resumes before or after checkpoint publication", async (t) => {
  for (const mode of ["checkpoint write fails", "checkpoint readback aborts"]) await t.test(mode, async (t) => {
    const { db, store } = await fixture(t);
    recordPrivacyEvent(db, { id: "migration-new-event", kind: "account_erased", subjectId: "u_later", at: AT + 50 });
    const before = anchor(db);
    const replacement = storage(ENV_B);
    copyObjects(store, replacement);
    const controller = new AbortController();
    let published = false;
    replacement.setFault(({ key, method }) => {
      if (key !== COVERAGE_OBJECT) return null;
      if (method === "PUT") {
        if (mode === "checkpoint write fails") return new Response("", { status: 503 });
        published = true;
      }
      if (method === "GET" && published) { controller.abort(new Error("migration interrupted")); throw controller.signal.reason; }
      return null;
    });
    const first = shipPrivacyJournal(db, { env: ENV_B, fetchImpl: replacement.fetchImpl, now: () => AT + 60, signal: controller.signal });
    if (mode === "checkpoint readback aborts") await assert.rejects(first, /migration interrupted/u);
    else assert.equal((await first).error, "coverage_unconfirmed");
    assert.deepEqual(anchor(db), before);
    assert.equal(eventObjects(replacement).length, 5, "uploaded suffix survives an interrupted attempt");
    replacement.setFault(null);
    const retried = await shipPrivacyJournal(db, { env: ENV_B, fetchImpl: replacement.fetchImpl, now: () => AT + 70 });
    assert.equal(retried.error, undefined);
    assert.equal(retried.pending, 0);
    assert.equal(readContinuity(db).shippedSequence, 5);
    assert.equal(readContinuity(db).storageIdentity, backupStorageIdentity(ENV_B));
    gate(db);
    assert.equal((await replay(db, replacement, ENV_B)).verified, 5);
  });
});

test("a fresh stream cannot overwrite another stream's signed checkpoint", async (t) => {
  const { store } = await fixture(t);
  const other = database(t);
  recordPrivacyEvent(other, { kind: "account_erased", subjectId: "u_other_stream", at: AT + 50 });
  const existing = store.objects.get(COVERAGE_OBJECT);
  const callOffset = store.calls.length;
  const result = await shipPrivacyJournal(other, { env: ENV_A, fetchImpl: store.fetchImpl, now: () => AT + 60 });
  assert.equal(result.error, "coverage_unconfirmed");
  assert.equal(store.objects.get(COVERAGE_OBJECT), existing);
  assert.equal(store.calls.slice(callOffset).some((call) => call.method === "PUT" && call.key !== COVERAGE_OBJECT), false);
  assert.equal(readContinuity(other).shippedSequence, 0);
  assert.equal(privacyJournalStatus(other, ENV_A).continuityReady, false);
});

test("checkpoint preconditions prevent a stale writer from replacing newer signed coverage", async (t) => {
  const { db, store } = await fixture(t);
  recordPrivacyEvent(db, { id: "conditional-event-5", kind: "account_erased", subjectId: "u_fifth", at: AT + 50 });
  const local = signPrivacyEntry(JSON.parse(db.prepare("SELECT entry_json FROM privacy_journal_outbox WHERE id=?").get("conditional-event-5").entry_json), KEY);
  const next = signPrivacyEntry({ v: 2, id: "conditional-event-6", kind: "account_erased", subjectId: "u_sixth", at: AT + 51,
    streamId: local.streamId, sequence: 6, previous: privacyEntryHead(local) }, KEY);
  const newer = signCoverage({ storageIdentity: backupStorageIdentity(ENV_A), streamId: local.streamId,
    sequence: 6, head: privacyEntryHead(next), legacyUnknown: false, at: AT + 70 }, KEY);
  const before = anchor(db);
  let raced = false;
  store.setFault(({ key, method, init }) => {
    if (key === COVERAGE_OBJECT && method === "PUT") {
      assert.ok(new Headers(init.headers).get("If-Match"), "checkpoint replacement must compare the authenticated ETag");
      store.objects.set(privacyObjectKey(local), JSON.stringify(local));
      store.objects.set(privacyObjectKey(next), JSON.stringify(next));
      store.objects.set(COVERAGE_OBJECT, JSON.stringify(newer));
      raced = true;
    }
    return null;
  });
  const result = await shipPrivacyJournal(db, { env: ENV_A, fetchImpl: store.fetchImpl, now: () => AT + 60 });
  assert.equal(raced, true);
  assert.equal(result.error, "coverage_unconfirmed");
  assert.equal(store.objects.get(COVERAGE_OBJECT), JSON.stringify(newer));
  assert.deepEqual(anchor(db), before);
  assert.equal(db.prepare("SELECT shipped_at FROM privacy_journal_outbox WHERE id=?").get(local.id).shipped_at, null);
});

test("overlapping shippers on one database share one authenticated shipment", async (t) => {
  const db = database(t);
  const store = storage();
  recordPrivacyEvent(db, { kind: "marketing_opt_out", subjectId: "u_overlap", at: AT });
  const first = shipPrivacyJournal(db, { env: ENV_A, fetchImpl: store.fetchImpl, now: () => AT + 10 });
  const second = shipPrivacyJournal(db, { env: ENV_A, fetchImpl: store.fetchImpl, now: () => AT + 10 });
  assert.equal(first, second);
  assert.equal((await first).shipped, 1);
  assert.equal(store.calls.filter((call) => call.method === "PUT" && call.key !== COVERAGE_OBJECT).length, 1);
  assert.equal(readContinuity(db).shippedSequence, 1);
});

test("an aborted published checkpoint resumes with a smaller shipping batch without rolling coverage back", async (t) => {
  for (const destination of ["same", "migrated"]) await t.test(destination, async (t) => {
    const { db, store } = await fixture(t);
    const env = destination === "same" ? ENV_A : ENV_B;
    const target = destination === "same" ? store : storage(env);
    if (target !== store) copyObjects(store, target);
    for (let index = 0; index < 4; index += 1) {
      recordPrivacyEvent(db, { id: `smaller-batch-event-${index}`, kind: "account_erased", subjectId: `u_later_${index}`, at: AT + 50 + index });
    }
    const before = anchor(db);
    const controller = new AbortController();
    let published = false;
    target.setFault(({ key, method }) => {
      if (key !== COVERAGE_OBJECT) return null;
      if (method === "PUT") published = true;
      if (method === "GET" && published) { controller.abort(new Error("published checkpoint interrupted")); throw controller.signal.reason; }
      return null;
    });
    await assert.rejects(shipPrivacyJournal(db, { env, fetchImpl: target.fetchImpl, now: () => AT + 60, limit: 20, signal: controller.signal }), /published checkpoint interrupted/u);
    assert.deepEqual(anchor(db), before);
    const publishedCoverage = JSON.parse(target.objects.get(COVERAGE_OBJECT));
    assert.equal(publishedCoverage.sequence, 8);
    target.setFault(null);
    const pending = privacyJournalStatus(db, env).pending;
    for (let attempt = 0; attempt < pending; attempt += 1) {
      const result = await shipPrivacyJournal(db, { env, fetchImpl: target.fetchImpl, now: () => AT + 70 + attempt, limit: 1 });
      assert.equal(result.error, undefined);
      assert.equal(result.shipped, 1);
      assert.equal(result.pending, pending - attempt - 1);
      const current = JSON.parse(target.objects.get(COVERAGE_OBJECT));
      assert.equal(current.sequence, publishedCoverage.sequence);
      assert.equal(current.head, publishedCoverage.head);
      assert.equal(readContinuity(db).shippedSequence, publishedCoverage.sequence);
    }
    gate(db);
    assert.equal((await replay(db, target, env)).verified, 8);
  });
});
