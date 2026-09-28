import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { RESTORE_GATE_KEY } from "./databaseRecovery.js";
import {
  PRIVACY_REPLAY_EVIDENCE_KEY,
  ensurePrivacyJournalSchema,
  listPrivacyJournal,
  privacyJournalStatus,
  privacyObjectKey,
  recordPrivacyEvent,
  replayPrivacyEntries,
  replayPrivacyJournalIfRestored,
  restoredDatabaseNeedsReplay,
  shipPrivacyJournal,
  signPrivacyEntry,
  startPrivacyJournalShipper,
  verifyPrivacyEntry,
} from "./privacyJournal.js";

const KEY_TEXT = "k".repeat(40);
const KEY = Buffer.from(KEY_TEXT);
const AT = Date.parse("2026-09-27T20:00:00Z");
const ENDPOINT = "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com";
const ENV = {
  PRIVACY_JOURNAL_KEY: KEY_TEXT,
  BACKUP_S3_ENDPOINT: ENDPOINT,
  BACKUP_S3_BUCKET: "mshpit-backups",
  BACKUP_S3_ACCESS_KEY_ID: "backup-access",
  BACKUP_S3_SECRET_ACCESS_KEY: "backup-secret",
};

function database(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec("CREATE TABLE app_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
  ensurePrivacyJournalSchema(db);
  return db;
}

// A private R2 bucket: unsigned requests are refused, signed ones work.
function bucket({ failPutAfter = Infinity } = {}) {
  const objects = new Map();
  const calls = [];
  let puts = 0;
  const fetchImpl = async (url, init = {}) => {
    const target = new URL(url);
    const signed = target.searchParams.has("X-Amz-Signature");
    calls.push({ method: init.method, path: target.pathname, signed });
    if (!signed) return new Response("", { status: 403 });
    const key = decodeURIComponent(target.pathname.replace(/^\/mshpit-backups\/?/u, ""));
    if (init.method === "PUT") {
      puts += 1;
      if (puts > failPutAfter) return new Response("", { status: 503 });
      objects.set(key, init.body);
      return new Response("", { status: 200 });
    }
    if (!key) {
      const names = [...objects.keys()].filter((name) => name.startsWith(target.searchParams.get("prefix") || "")).sort();
      const start = Number(target.searchParams.get("continuation-token") || 0);
      const page = names.slice(start, start + 2);
      const more = start + 2 < names.length;
      return new Response(`<ListBucketResult>${page.map((name) => `<Contents><Key>${name}</Key></Contents>`).join("")}<IsTruncated>${more}</IsTruncated>${more ? `<NextContinuationToken>${start + 2}</NextContinuationToken>` : ""}</ListBucketResult>`);
    }
    return objects.has(key) ? new Response(objects.get(key)) : new Response("", { status: 404 });
  };
  return { objects, calls, fetchImpl };
}

test("entries are signed, tamper-evident and named by day", () => {
  const entry = signPrivacyEntry({ id: "0f6c2d1e-aaaa-4bbb-8ccc-000000000001", kind: "account_erased", subjectId: "u_abc", at: AT }, KEY);
  assert.equal(verifyPrivacyEntry(entry, KEY), true);
  assert.equal(verifyPrivacyEntry({ ...entry, subjectId: "u_other" }, KEY), false, "a changed account ID fails");
  assert.equal(verifyPrivacyEntry({ ...entry, kind: "marketing_opt_out" }, KEY), false);
  assert.equal(verifyPrivacyEntry(entry, Buffer.from("x".repeat(40))), false, "another key fails");
  assert.equal(verifyPrivacyEntry({ ...entry, mac: undefined }, KEY), false, "unsigned entries fail");
  assert.equal(privacyObjectKey(entry), `privacy-journal/v1/2026/09/27/${AT}-${entry.id}.json`);
  assert.deepEqual(Object.keys(entry).sort(), ["at", "id", "kind", "mac", "subjectId", "v"], "no email, name or content");
});

test("events wait without a key or storage, then ship oldest first and stop at a failure", async (t) => {
  const db = database(t);
  assert.throws(() => recordPrivacyEvent(db, { kind: "post_deleted", subjectId: "u_a", at: AT }), /Invalid/u);
  assert.throws(() => recordPrivacyEvent(db, { kind: "account_erased", subjectId: "a@b.com", at: AT }), /Invalid/u, "never an email address");
  recordPrivacyEvent(db, { kind: "account_erased", subjectId: "u_a", at: AT, id: "00000000-0000-4000-8000-000000000001" });
  recordPrivacyEvent(db, { kind: "marketing_opt_out", subjectId: "u_b", at: AT + 1, id: "00000000-0000-4000-8000-000000000002" });
  recordPrivacyEvent(db, { kind: "account_erased", subjectId: "u_c", at: AT + 2, id: "00000000-0000-4000-8000-000000000003" });

  assert.deepEqual(await shipPrivacyJournal(db, { env: { ...ENV, PRIVACY_JOURNAL_KEY: "" } }), { shipped: 0, pending: 3, waiting: "key" });
  assert.deepEqual(await shipPrivacyJournal(db, { env: { PRIVACY_JOURNAL_KEY: KEY_TEXT } }), { shipped: 0, pending: 3, waiting: "storage" });

  const flaky = bucket({ failPutAfter: 1 });
  const partial = await shipPrivacyJournal(db, { env: ENV, fetchImpl: flaky.fetchImpl, now: () => AT + 10 });
  assert.deepEqual(partial, { shipped: 1, pending: 2, waiting: null, error: "HTTP_503" });
  assert.ok(flaky.calls.slice(0, 2).every((call) => !call.signed), "the bucket is proven private before anything is sent");
  assert.equal(privacyJournalStatus(db, ENV).lastError, "HTTP_503");

  const store = bucket();
  const rest = await shipPrivacyJournal(db, { env: ENV, fetchImpl: store.fetchImpl, now: () => AT + 20 });
  assert.deepEqual(rest, { shipped: 2, pending: 0, waiting: null });
  const shipped = [...store.objects.values()].map((body) => JSON.parse(body));
  assert.deepEqual(shipped.map((entry) => entry.subjectId), ["u_b", "u_c"]);
  assert.ok(shipped.every((entry) => verifyPrivacyEntry(entry, KEY)));
  const status = privacyJournalStatus(db, ENV);
  assert.deepEqual({ pending: status.pending, lastShippedAt: status.lastShippedAt, signingKey: status.signingKey, storage: status.storage },
    { pending: 0, lastShippedAt: AT + 20, signingKey: true, storage: true });
});

test("replay validates all entries before mutation, then applies valid entries once in time order", () => {
  const entry = (id, kind, subjectId, at, key = KEY) => signPrivacyEntry({ id, kind, subjectId, at }, key);
  const entries = [
    entry("00000000-0000-4000-8000-00000000000b", "marketing_opt_out", "u_keep", AT + 5),
    entry("00000000-0000-4000-8000-00000000000a", "account_erased", "u_gone", AT),
    entry("00000000-0000-4000-8000-00000000000a", "account_erased", "u_gone", AT),
    entry("00000000-0000-4000-8000-00000000000c", "account_erased", "u_victim", AT + 9, Buffer.from("f".repeat(40))),
    entry("00000000-0000-4000-8000-00000000000d", "account_erased", "u_never_restored", AT + 7),
  ];
  const applied = [];
  const callbacks = {
    erase: (id) => { applied.push(`erase:${id}`); return id !== "u_never_restored"; },
    optOut: (id) => { applied.push(`opt-out:${id}`); return true; } };
  assert.throws(() => replayPrivacyEntries({ entries, key: KEY, ...callbacks }), { code: "PRIVACY_JOURNAL_INVALID" });
  assert.deepEqual(applied, [], "a bad last entry prevents every earlier mutation");
  const counts = replayPrivacyEntries({ entries: entries.filter((_, index) => index !== 3), key: KEY, ...callbacks });
  assert.deepEqual(applied, ["erase:u_gone", "opt-out:u_keep", "erase:u_never_restored"]);
  assert.deepEqual(counts, { entries: 4, verified: 3, rejected: 0, erased: 1, optedOut: 1, absent: 1, newestAt: AT + 7 });
});

test("a restored database must replay the journal before serving, once", async (t) => {
  const db = database(t);
  assert.equal(restoredDatabaseNeedsReplay(db), null, "a live database has no restore gate");
  assert.deepEqual(await replayPrivacyJournalIfRestored(db, { env: {} }), { needed: false });

  db.prepare("INSERT INTO app_meta VALUES (?,?)").run(RESTORE_GATE_KEY, JSON.stringify({ version: 1, state: "reviewed", preparedAt: AT }));
  const store = bucket();
  for (const [index, subjectId] of ["u_a", "u_b", "u_c"].entries()) {
    const signed = signPrivacyEntry({ id: `00000000-0000-4000-8000-00000000000${index}`, kind: "account_erased", subjectId, at: AT - 1000 + index }, KEY);
    store.objects.set(privacyObjectKey(signed), JSON.stringify(signed));
  }
  store.objects.set("privacy-journal/v1/2026/09/27/broken.json", "{not json");
  const listed = await listPrivacyJournal({ env: ENV, fetchImpl: store.fetchImpl });
  assert.equal(listed.entries.length, 3, "listing follows continuation pages");
  assert.equal(listed.unreadable, 1);

  await assert.rejects(replayPrivacyJournalIfRestored(db, { env: { ...ENV, PRIVACY_JOURNAL_KEY: "" }, erase: () => true, optOut: () => true }),
    (error) => error.code === "PRIVACY_JOURNAL_REPLAY_REQUIRED", "no key: startup stops");
  assert.ok(restoredDatabaseNeedsReplay(db), "a failed replay leaves the requirement in place");

  const erased = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(replayPrivacyJournalIfRestored(db, { env: ENV, fetchImpl: store.fetchImpl,
      erase: (id) => { erased.push(id); return true; }, optOut: () => false }), { code: "PRIVACY_JOURNAL_REPLAY_REQUIRED" });
    assert.deepEqual(erased, [], "an unreadable entry prevents partial erasure");
    assert.ok(restoredDatabaseNeedsReplay(db), "a later startup must retry rather than serve an incomplete restore");
    assert.equal(db.prepare("SELECT value FROM app_meta WHERE key=?").get(PRIVACY_REPLAY_EVIDENCE_KEY), undefined);
  }
  store.objects.delete("privacy-journal/v1/2026/09/27/broken.json");
  const result = await replayPrivacyJournalIfRestored(db, { env: ENV, fetchImpl: store.fetchImpl, now: () => AT + 1,
    erase: (id) => { erased.push(id); return true; }, optOut: () => false });
  assert.deepEqual(erased, ["u_a", "u_b", "u_c"]);
  assert.deepEqual({ needed: result.needed, erased: result.erased, unreadable: result.unreadable, preparedAt: result.preparedAt },
    { needed: true, erased: 3, unreadable: 0, preparedAt: AT });
  assert.equal(JSON.parse(db.prepare("SELECT value FROM app_meta WHERE key=?").get(PRIVACY_REPLAY_EVIDENCE_KEY).value).erased, 3);
  assert.deepEqual(await replayPrivacyJournalIfRestored(db, { env: ENV, fetchImpl: store.fetchImpl }), { needed: false }, "evidence ends the requirement");

  // A later restore (new preparation) needs its own replay; an owner waiver is recorded instead.
  db.prepare("UPDATE app_meta SET value=? WHERE key=?").run(JSON.stringify({ version: 1, state: "reviewed", preparedAt: AT + 50 }), RESTORE_GATE_KEY);
  const waived = await replayPrivacyJournalIfRestored(db, { env: { PRIVACY_JOURNAL_REPLAY_WAIVER: "incident-2026-10/privacy" }, now: () => AT + 60 });
  assert.deepEqual({ waived: waived.waived, reason: waived.reason }, { waived: "incident-2026-10/privacy", reason: "PRIVACY_JOURNAL_UNAVAILABLE" });
  assert.equal(restoredDatabaseNeedsReplay(db), null);
});

test("wrong-key erasure entries block every startup until repaired or explicitly waived", async (t) => {
  const db = database(t);
  db.exec("CREATE TABLE users(id TEXT PRIMARY KEY)");
  db.prepare("INSERT INTO users VALUES (?)").run("u_restored");
  db.prepare("INSERT INTO app_meta VALUES (?,?)").run(RESTORE_GATE_KEY, JSON.stringify({ version: 1, state: "reviewed", preparedAt: AT }));
  const store = bucket();
  const entry = signPrivacyEntry({ id: "00000000-0000-4000-8000-000000000099", kind: "account_erased", subjectId: "u_restored", at: AT + 1 }, Buffer.from("old-key".repeat(8)));
  store.objects.set(privacyObjectKey(entry), JSON.stringify(entry));
  const erase = (id) => db.prepare("DELETE FROM users WHERE id=?").run(id).changes > 0;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(replayPrivacyJournalIfRestored(db, { env: ENV, fetchImpl: store.fetchImpl, erase, optOut: () => false }), { code: "PRIVACY_JOURNAL_REPLAY_REQUIRED" });
    assert.ok(restoredDatabaseNeedsReplay(db));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users").get().n, 1, "verification failure does not mutate the recovery copy");
  }
  const waived = await replayPrivacyJournalIfRestored(db, { env: { ...ENV, PRIVACY_JOURNAL_REPLAY_WAIVER: "incident-2026-09/manual-privacy-review" }, fetchImpl: store.fetchImpl, erase, optOut: () => false });
  assert.equal(waived.reason, "PRIVACY_JOURNAL_INVALID");
  assert.equal(restoredDatabaseNeedsReplay(db), null, "only the existing explicit waiver can accept incomplete evidence");
});

test("conflicting duplicate signed IDs and invalid dates fail before mutations", () => {
  const base = { id: "00000000-0000-4000-8000-000000000001", kind: "marketing_opt_out", subjectId: "u_a", at: AT };
  let mutations = 0;
  const callbacks = { erase: () => { mutations += 1; }, optOut: () => { mutations += 1; } };
  assert.throws(() => replayPrivacyEntries({ key: KEY, entries: [signPrivacyEntry(base, KEY), signPrivacyEntry({ ...base, kind: "account_erased", subjectId: "u_b" }, KEY)], ...callbacks }), { code: "PRIVACY_JOURNAL_INVALID" });
  assert.equal(mutations, 0);
  for (const at of [0, -1, 8_640_000_000_000_001]) assert.equal(verifyPrivacyEntry(signPrivacyEntry({ ...base, at }, KEY), KEY), false);
  assert.equal(verifyPrivacyEntry({ ...signPrivacyEntry(base, KEY), mac: `${signPrivacyEntry(base, KEY).mac}garbage` }, KEY), false);
});

test("legacy, incomplete and malformed replay receipts never grant restore readiness", (t) => {
  const db = database(t);
  db.prepare("INSERT INTO app_meta VALUES (?,?)").run(RESTORE_GATE_KEY, JSON.stringify({ version: 1, state: "reviewed", preparedAt: AT }));
  const put = db.prepare("INSERT INTO app_meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  const good = { version: 1, verificationVersion: 2, preparedAt: AT, replayedAt: AT + 1, entries: 0, verified: 0, rejected: 0, erased: 0, optedOut: 0, absent: 0, unreadable: 0, newestAt: null };
  for (const bad of [{ preparedAt: AT }, { ...good, verificationVersion: undefined }, { ...good, rejected: 1 }, { ...good, unreadable: 1 }, { ...good, verified: 1 }, { ...good, replayedAt: AT - 1 }, { ...good, entries: -1 }]) {
    put.run(PRIVACY_REPLAY_EVIDENCE_KEY, JSON.stringify(bad));
    assert.ok(restoredDatabaseNeedsReplay(db));
  }
  put.run(PRIVACY_REPLAY_EVIDENCE_KEY, JSON.stringify(good));
  assert.equal(restoredDatabaseNeedsReplay(db), null);
  put.run(PRIVACY_REPLAY_EVIDENCE_KEY, JSON.stringify({ version: 1, preparedAt: AT, replayedAt: AT + 1, waived: "incident/prior-owner-review", reason: "PRIVACY_JOURNAL_UNAVAILABLE" }));
  assert.equal(restoredDatabaseNeedsReplay(db), null, "an existing explicit owner waiver is preserved");
});

test("listing rejects HTTP 200 error pages, incomplete XML and repeated pagination", async () => {
  for (const xml of ["<html>error</html>", "<ListBucketResult><IsTruncated>false</IsTruncated>", "<ListBucketResult><Contents><IsTruncated>false</IsTruncated></ListBucketResult>", "<ListBucketResult><IsTruncated>false</IsTruncated><IsTruncated>true</IsTruncated></ListBucketResult>"]) {
    await assert.rejects(listPrivacyJournal({ env: ENV, fetchImpl: async () => new Response(xml) }), { code: "PRIVACY_JOURNAL_INVALID" });
  }
  let calls = 0;
  await assert.rejects(listPrivacyJournal({ env: ENV, fetchImpl: async () => {
    calls += 1;
    return new Response("<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>same-token</NextContinuationToken></ListBucketResult>");
  } }), { code: "PRIVACY_JOURNAL_INVALID" });
  assert.equal(calls, 2);
  const empty = await listPrivacyJournal({ env: ENV, fetchImpl: async () => new Response('<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>false</IsTruncated></ListBucketResult>') });
  assert.deepEqual(empty, { entries: [], unreadable: 0 }, "a valid empty S3 listing remains valid");
});

test("journal response byte limits stop reading and cancel oversized bodies", async () => {
  let pulled = 0;
  let cancelled = 0;
  const oversized = (chunkBytes) => new Response(new ReadableStream({
    pull(controller) { pulled += 1; controller.enqueue(new Uint8Array(chunkBytes)); },
    cancel() { cancelled += 1; },
  }, { highWaterMark: 0 }));
  await assert.rejects(listPrivacyJournal({ env: ENV, fetchImpl: async () => oversized(1024 * 1024) }), { code: "PRIVACY_JOURNAL_INVALID" });
  assert.equal(pulled, 5, "listing stops at the first chunk over 4MiB");
  assert.equal(cancelled, 1);
  pulled = 0;
  const listed = await listPrivacyJournal({ env: ENV, fetchImpl: async (url) => new URL(url).searchParams.has("list-type")
    ? new Response("<ListBucketResult><Contents><Key>privacy-journal/v1/oversized.json</Key></Contents><IsTruncated>false</IsTruncated></ListBucketResult>")
    : oversized(1024) });
  assert.equal(listed.unreadable, 1);
  assert.equal(pulled, 5, "objects stop at the first chunk over 4KiB");
  assert.equal(cancelled, 2);
});

test("privacy shipper shutdown aborts active transport and preserves pending work", async (t) => {
  const db = database(t);
  recordPrivacyEvent(db, { kind: "account_erased", subjectId: "u_shutdown", at: AT });
  let entered;
  const uploading = new Promise((resolve) => { entered = resolve; });
  let putCalls = 0;
  const job = startPrivacyJournalShipper({ database: db, env: ENV, logger: { error() {} }, fetchImpl: async (_, init) => {
    if (init.method !== "PUT") return new Response("", { status: 403 });
    putCalls += 1;
    entered();
    return new Promise((_, reject) => {
      if (init.signal.aborted) reject(init.signal.reason);
      else init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    });
  } });
  t.after(() => job.stop({ abortActive: true }));
  const active = job.trigger();
  await uploading;
  await job.stop({ abortActive: true });
  assert.equal(await active, false);
  assert.equal(putCalls, 1);
  assert.equal(privacyJournalStatus(db, ENV).pending, 1);
  assert.equal(privacyJournalStatus(db, ENV).lastError, null, "shutdown is not misreported as a provider failure");
});
