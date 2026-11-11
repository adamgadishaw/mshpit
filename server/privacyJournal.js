// Privacy journal (SECURITY.md, section 2). A database restored from a backup
// would bring back accounts that were erased, and email consent that was
// withdrawn, after that backup was taken. Each such decision is written here
// in the same transaction as the change, signed, and shipped to the private
// backup bucket, outside the SQLite file. A restored database replays the
// journal before it serves anyone (replayPrivacyJournalIfRestored).
//
// Entries hold only an opaque account ID, the kind of decision and its time:
// no email address, name or content.
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { presignS3Request } from "./media.js";
import { privateBackupStorageConfig, verifyPrivateBackupBucket } from "./backupStorageSecurity.js";
import { RESTORE_GATE_KEY } from "./databaseRecovery.js";
import { startPeriodicJob } from "./periodicJobScheduler.js";
import { backupStorageIdentity } from "./backupStorageIdentity.js";
import { privateErrorLabel } from "./errors.js";
import { CONTINUITY_KEY, COVERAGE_OBJECT, EMPTY_HEAD, canonicalPrivacyEntry,
  privacyEntryHead, validChainFields, readContinuity, writeContinuity,
  signCoverage, verifyCoverage, verifyContinuityChain } from "./privacyJournalContinuity.js";

export const PRIVACY_JOURNAL_KINDS = Object.freeze(["account_erased", "marketing_opt_out"]);
export const PRIVACY_JOURNAL_PREFIX = "privacy-journal/v1/";
export const PRIVACY_REPLAY_EVIDENCE_KEY = "privacy-journal:replay:v1";
const KINDS = new Set(PRIVACY_JOURNAL_KINDS);
const SUBJECT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/u;
const ENTRY_ID = /^[A-Za-z0-9-]{8,64}$/u;
const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,159}$/u;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const SHIPPED_RETENTION_MS = 30 * DAY;
const MAX_OBJECTS = 20_000;
const MAX_OBJECT_BYTES = 4096;
const MAX_LIST_PAGES = 1000;
const shipping = new WeakMap();

function journalError(code = "PRIVACY_JOURNAL_INVALID") {
  return Object.assign(new Error("Privacy journal verification did not complete."), { code });
}

export function ensurePrivacyJournalSchema(database) {
  const existed = !!database.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='privacy_journal_outbox'").get();
  database.exec(`CREATE TABLE IF NOT EXISTS privacy_journal_outbox (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    at INTEGER NOT NULL,
    shipped_at INTEGER,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_privacy_journal_outbox_pending ON privacy_journal_outbox(shipped_at,at);`);
  const columns = new Set(database.prepare("PRAGMA table_info(privacy_journal_outbox)").all().map((row) => row.name));
  if (!columns.has("entry_json")) database.exec("ALTER TABLE privacy_journal_outbox ADD COLUMN entry_json TEXT");
  if (!columns.has("shipped_storage_identity")) database.exec("ALTER TABLE privacy_journal_outbox ADD COLUMN shipped_storage_identity TEXT");
  if (!database.prepare("SELECT 1 FROM app_meta WHERE key=?").get(CONTINUITY_KEY)) {
    const restored = !!database.prepare("SELECT 1 FROM app_meta WHERE key=?").get(RESTORE_GATE_KEY);
    writeContinuity(database, { version: 1, streamId: randomUUID(), sequence: 0, head: EMPTY_HEAD,
      shippedSequence: 0, shippedHead: EMPTY_HEAD, storageIdentity: null, legacyUnknown: existed || restored });
  }
}

// Call inside the transaction that makes the change, so the two commit together.
export function recordPrivacyEvent(database, { kind, subjectId, at = Date.now(), id = randomUUID() } = {}) {
  if (!KINDS.has(kind) || !SUBJECT.test(String(subjectId || "")) || !ENTRY_ID.test(id) || !Number.isSafeInteger(at) || at < 1) {
    throw new TypeError("Invalid privacy journal entry.");
  }
  database.exec("SAVEPOINT privacy_journal_append");
  try {
    const state = readContinuity(database);
    if (!state || state.sequence >= Number.MAX_SAFE_INTEGER) throw journalError("PRIVACY_JOURNAL_CONTINUITY_UNKNOWN");
    const entry = { v: 2, id, kind, subjectId, at, streamId: state.streamId, sequence: state.sequence + 1, previous: state.head };
    database.prepare("INSERT INTO privacy_journal_outbox (id,kind,subject_id,at,entry_json) VALUES (?,?,?,?,?)")
      .run(id, kind, subjectId, at, JSON.stringify(entry));
    writeContinuity(database, { ...state, sequence: entry.sequence, head: privacyEntryHead(entry) });
    database.exec("RELEASE privacy_journal_append");
    return id;
  } catch (error) {
    database.exec("ROLLBACK TO privacy_journal_append; RELEASE privacy_journal_append");
    throw error;
  }
}

// PRIVACY_JOURNAL_KEY signs entries. Keep it only in the server environment,
// never in the database or the bucket. Preserve historical verification while
// any corresponding journal entry or backup remains recoverable. A fresh backup
// alone is not a safe key-rotation procedure. See SECURITY.md.
export function privacyJournalKey(env = process.env) {
  const value = String(env.PRIVACY_JOURNAL_KEY || "").trim();
  return value.length >= 32 ? Buffer.from(value, "utf8") : null;
}

const canonical = canonicalPrivacyEntry;
const mac = (entry, key) => createHmac("sha256", key).update(canonical(entry)).digest("hex");

export function signPrivacyEntry(entry, key) {
  const plain = { v: entry.v === 2 ? 2 : 1, id: entry.id, kind: entry.kind, subjectId: entry.subjectId, at: entry.at,
    ...(entry.v === 2 ? { streamId: entry.streamId, sequence: entry.sequence, previous: entry.previous } : {}) };
  return { ...plain, mac: mac(plain, key) };
}

export function verifyPrivacyEntry(entry, key) {
  if (!key || ![1, 2].includes(entry?.v) || (entry.v === 2 && !validChainFields(entry)) || !KINDS.has(entry?.kind)
    || typeof entry?.subjectId !== "string" || !SUBJECT.test(entry.subjectId)
    || typeof entry?.id !== "string" || !ENTRY_ID.test(entry.id)
    || !Number.isSafeInteger(entry?.at) || entry.at < 1 || entry.at > 8_640_000_000_000_000
    || typeof entry?.mac !== "string" || !/^[a-f0-9]{64}$/u.test(entry.mac)) return false;
  const expected = Buffer.from(mac(entry, key), "hex");
  const actual = Buffer.from(entry.mac, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function privacyObjectKey(entry) {
  const day = new Date(entry.at).toISOString().slice(0, 10).replaceAll("-", "/");
  return `${PRIVACY_JOURNAL_PREFIX}${day}/${entry.at}-${entry.id}.json`;
}

function bucketUrl(config, key = "") {
  const prefix = config.endpoint.pathname.replace(/\/+$/u, "");
  const encodedKey = String(key).split("/").map(encodeURIComponent).join("/");
  return `${config.endpoint.origin}${prefix}/${encodeURIComponent(config.bucket)}${encodedKey ? `/${encodedKey}` : ""}`;
}

function signer(env) {
  return (method, url, headers = {}) => presignS3Request({
    method, url, headers,
    region: String(env.BACKUP_S3_REGION || "auto").trim(),
    accessKeyId: String(env.BACKUP_S3_ACCESS_KEY_ID).trim(),
    secretAccessKey: String(env.BACKUP_S3_SECRET_ACCESS_KEY).trim(),
    expiresIn: 600,
  });
}

async function discard(response) {
  try { await response?.body?.cancel?.(); }
  catch { /* architecture: allow-empty-catch -- releasing a response body is best-effort */ }
}

async function limitedText(response, maxBytes) {
  const reader = response.body?.getReader?.();
  if (!reader) throw journalError();
  const chunks = [];
  let bytes = 0;
  try {
    const declared = response.headers?.get?.("content-length");
    if (declared !== null && declared !== undefined && Number(declared) > maxBytes) throw journalError();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw journalError();
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, bytes).toString("utf8");
  } finally {
    try { await reader.cancel(); }
    catch { /* architecture: allow-empty-catch -- bounded response cleanup must not replace the verification failure */ }
    reader.releaseLock();
  }
}

// Ships pending entries, oldest first, stopping at the first failure so the
// order is kept. Without a key or private storage nothing leaves the server,
// and the entries wait in the outbox.
export function shipPrivacyJournal(database, options = {}) {
  if (shipping.has(database)) return shipping.get(database);
  const captured = { ...options, env: { ...(options.env ?? process.env) } };
  const active = Promise.resolve().then(() => shipPrivacyJournalBatch(database, captured)).finally(() => shipping.delete(database));
  shipping.set(database, active);
  return active;
}

async function shipPrivacyJournalBatch(database, { env = process.env, fetchImpl = fetch, now = Date.now, limit = 50, signal } = {}) {
  // Capture storage identity and credentials together across asynchronous work.
  env = { ...env };
  signal?.throwIfAborted();
  const deadline = AbortSignal.any([AbortSignal.timeout(120_000), signal].filter(Boolean));
  const request = (url, options) => fetchImpl(url, {
    ...options, signal: AbortSignal.any([deadline, options.signal].filter(Boolean)),
  });
  const identity = backupStorageIdentity(env);
  const pendingSql = "(shipped_at IS NULL OR shipped_storage_identity IS NULL OR shipped_storage_identity<>?)";
  const pending = Number(database.prepare("SELECT COUNT(*) AS n FROM privacy_journal_outbox WHERE " + pendingSql).get(identity || "").n) || 0;
  const key = privacyJournalKey(env);
  const config = privateBackupStorageConfig(env);
  if (!key) return { shipped: 0, pending, waiting: "key" };
  if (!config) return { shipped: 0, pending, waiting: "storage" };
  const state = readContinuity(database);
  if (!state) return { shipped: 0, pending, waiting: "continuity", error: "continuity_unknown" };
  const rememberFailure = (code) => {
    const current = readContinuity(database);
    if (current?.streamId === state.streamId) writeContinuity(database, { ...current, lastError: code });
  };
  const moved = state.storageIdentity && state.storageIdentity !== identity;
  let priorCoverage;
  if (moved) {
    try {
      const coverage = await readCoverage({ env, fetchImpl: request, key });
      const listed = await listPrivacyJournal({ env, fetchImpl: request });
      const covered = listed.entries.filter((entry) => entry.sequence <= coverage.sequence);
      const suffix = listed.entries.filter((entry) => entry.sequence > coverage.sequence).sort((a, b) => a.sequence - b.sequence);
      if (![state.storageIdentity, identity].includes(coverage.storageIdentity)
        || coverage.sequence < state.shippedSequence || coverage.sequence > state.sequence || listed.unreadable
        || !listed.entries.every((entry) => verifyPrivacyEntry(entry, key))
        || covered.length + suffix.length !== listed.entries.length
        || !verifyContinuityChain(covered, coverage, { ...state, sequence: state.shippedSequence, head: state.shippedHead })) {
        throw journalError("PRIVACY_JOURNAL_CONTINUITY_UNKNOWN");
      }
      // A killed migration may leave uploaded events beyond its last confirmed
      // checkpoint. Accept that suffix only when every link is still present in
      // this live database's immutable outbox. Restore itself never accepts it.
      let suffixHead = coverage.head;
      let suffixSequence = coverage.sequence;
      const localEntry = database.prepare("SELECT entry_json FROM privacy_journal_outbox WHERE id=?");
      for (const entry of suffix) {
        const local = localEntry.get(entry.id)?.entry_json;
        if (!local || entry.v !== 2 || entry.streamId !== state.streamId || entry.sequence !== ++suffixSequence
          || entry.sequence > state.sequence || entry.previous !== suffixHead || canonical(JSON.parse(local)) !== canonical(entry)) throw journalError();
        suffixHead = privacyEntryHead(entry);
      }
      priorCoverage = coverage;
    } catch {
      signal?.throwIfAborted();
      rememberFailure("continuity_unknown");
      return { shipped: 0, pending, waiting: "continuity", error: "continuity_unknown" };
    }
  }
  const rows = database.prepare("SELECT id,kind,subject_id,at,entry_json FROM privacy_journal_outbox WHERE " + pendingSql
    + " ORDER BY CASE WHEN entry_json IS NULL THEN 0 ELSE 1 END, json_extract(entry_json,'$.sequence'),at,id LIMIT ?")
    .all(identity, Math.max(1, Math.min(200, Number(limit) || 50)));
  const sign = signer(env);
  const failed = database.prepare("UPDATE privacy_journal_outbox SET attempts=attempts+1,last_error=? WHERE id=?");
  const sent = [];
  let error = null;
  let sequence = state.shippedSequence;
  let head = state.shippedHead;
  try {
    await verifyPrivateBackupBucket({ env, fetchImpl: request, objectKey: PRIVACY_JOURNAL_PREFIX + "privacy-probe-" + randomUUID() });
  } catch {
    signal?.throwIfAborted();
    rememberFailure("storage_not_private");
    if (rows[0]) failed.run("storage_not_private", rows[0].id);
    return { shipped: 0, pending, waiting: null, error: "storage_not_private" };
  }
  try {
    if (!state.storageIdentity) {
      // Claim a fresh namespace before sending entries. Never overwrite another
      // database's checkpoint when a bucket is accidentally reused. A lost
      // response is retryable only when authenticated readback names our stream.
      const initial = signCoverage({ storageIdentity: identity, streamId: state.streamId,
        sequence: 0, head: EMPTY_HEAD, legacyUnknown: state.legacyUnknown, at: now() }, key);
      try {
        await putJournalObject({ sign, config, request, name: COVERAGE_OBJECT, value: initial,
          conditions: { "If-None-Match": "*" } });
      } catch (failure) { if (failure?.message !== "HTTP_412") throw failure; }
    }
    if (!priorCoverage) priorCoverage = await readCoverage({ env, fetchImpl: request, key });
    if (priorCoverage.streamId !== state.streamId || priorCoverage.legacyUnknown !== state.legacyUnknown
      || !(moved ? [state.storageIdentity, identity] : [identity]).includes(priorCoverage.storageIdentity)
      || priorCoverage.sequence < state.shippedSequence || priorCoverage.sequence > state.sequence
      || (priorCoverage.sequence === state.shippedSequence && priorCoverage.head !== state.shippedHead)) throw journalError();
    if (priorCoverage.sequence > state.shippedSequence) {
      const anchor = database.prepare("SELECT entry_json FROM privacy_journal_outbox WHERE json_extract(entry_json,'$.sequence')=?").get(priorCoverage.sequence);
      if (!anchor?.entry_json || privacyEntryHead(JSON.parse(anchor.entry_json)) !== priorCoverage.head) throw journalError();
    }
  } catch {
    signal?.throwIfAborted();
    rememberFailure("coverage_unconfirmed");
    return { shipped: 0, pending, waiting: null, error: "coverage_unconfirmed" };
  }
  // Publication can succeed just before shutdown prevents the local commit.
  // The authenticated checkpoint and matching local anchor let a smaller retry
  // batch acknowledge progress without ever publishing an older head.
  sequence = priorCoverage.sequence;
  head = priorCoverage.head;
  if (!pending && state.storageIdentity === identity) {
    if (state.lastError) {
      const current = readContinuity(database);
      if (current?.streamId === state.streamId) writeContinuity(database, { ...current, lastError: null });
    }
    return { shipped: 0, pending: 0, waiting: null };
  }
  for (const row of rows) {
    signal?.throwIfAborted();
    const plain = row.entry_json ? JSON.parse(row.entry_json) : { id: row.id, kind: row.kind, subjectId: row.subject_id, at: row.at };
    const entry = signPrivacyEntry(plain, key);
    // Already shipped rows copied during migration need no head advancement.
    if (entry.v === 2 && entry.sequence > sequence && (entry.sequence !== sequence + 1 || entry.previous !== head)) {
      error = "continuity_unknown";
      failed.run(error, row.id);
      break;
    }
    try {
      await putJournalObject({ sign, config, request, name: privacyObjectKey(entry), value: entry });
      sent.push(row.id);
      if (entry.v === 2 && entry.sequence > sequence) { sequence = entry.sequence; head = privacyEntryHead(entry); }
    } catch (failure) {
      signal?.throwIfAborted();
      error = /^HTTP_\d+$/u.test(failure?.message) ? failure.message : "network_error";
      rememberFailure(error);
      failed.run(error, row.id);
      break;
    }
  }
  if (sent.length || !pending || moved) {
    try {
      if (sequence < priorCoverage.sequence) throw journalError();
      const coverage = signCoverage({ storageIdentity: identity, streamId: state.streamId,
        sequence, head, legacyUnknown: state.legacyUnknown, at: now() }, key);
      await putJournalObject({ sign, config, request, name: COVERAGE_OBJECT, value: coverage,
        conditions: { "If-Match": priorCoverage.etag } });
      // Authenticate the stored checkpoint, not just its PUT response.
      const confirmed = await readCoverage({ env, fetchImpl: request, key });
      if (confirmed.mac !== coverage.mac) throw journalError();
      signal?.throwIfAborted();
      database.exec("SAVEPOINT privacy_journal_ship");
      try {
        const current = readContinuity(database);
        if (!current || current.streamId !== state.streamId || current.shippedSequence !== state.shippedSequence
          || current.storageIdentity !== state.storageIdentity) throw journalError();
        const mark = database.prepare("UPDATE privacy_journal_outbox SET shipped_at=?,shipped_storage_identity=?,last_error=NULL WHERE id=?");
        for (const id of sent) mark.run(now(), identity, id);
        writeContinuity(database, { ...current, storageIdentity: identity, shippedSequence: sequence, shippedHead: head, lastError: error });
        // Legacy unbound history stays available for manual recovery decisions.
        // Chained entries remain remotely verifiable after bounded local pruning.
        database.prepare("DELETE FROM privacy_journal_outbox WHERE entry_json IS NOT NULL AND shipped_storage_identity=? AND shipped_at<?")
          .run(identity, now() - SHIPPED_RETENTION_MS);
        database.exec("RELEASE privacy_journal_ship");
      } catch (failure) {
        database.exec("ROLLBACK TO privacy_journal_ship; RELEASE privacy_journal_ship");
        throw failure;
      }
    } catch {
      signal?.throwIfAborted();
      rememberFailure("coverage_unconfirmed");
      if (rows[0]) failed.run("coverage_unconfirmed", rows[0].id);
      return { shipped: 0, pending, waiting: null, error: "coverage_unconfirmed" };
    }
  }
  return { shipped: sent.length, pending: pending - sent.length, waiting: null, ...(error ? { error } : {}) };
}

async function putJournalObject({ sign, config, request, name, value, conditions = {} }) {
  const body = JSON.stringify(value);
  const headers = { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)), ...conditions };
  let response;
  try {
    response = await request(sign("PUT", bucketUrl(config, name), headers), {
      method: "PUT", headers, body, redirect: "manual", signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("HTTP_" + (Number(response.status) || 0));
  } finally { await discard(response); }
}

async function readCoverage({ env, fetchImpl, key }) {
  const config = privateBackupStorageConfig(env);
  const response = await fetchImpl(signer(env)("GET", bucketUrl(config, COVERAGE_OBJECT)),
    { method: "GET", redirect: "manual", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) { await discard(response); throw journalError("PRIVACY_JOURNAL_CONTINUITY_UNKNOWN"); }
  const etag = response.headers.get("etag");
  const value = JSON.parse(await limitedText(response, MAX_OBJECT_BYTES));
  if (!verifyCoverage(value, key) || !/^"[\x21\x23-\x7e]{1,128}"$/u.test(etag || "")) throw journalError("PRIVACY_JOURNAL_CONTINUITY_UNKNOWN");
  Object.defineProperty(value, "etag", { value: etag, enumerable: false });
  return value;
}

const xmlText = (value) => value.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", "\"")
  .replaceAll("&apos;", "'").replaceAll("&amp;", "&");

// Every journal object in the bucket, parsed. Unreadable objects are counted
// for diagnostics; the restore boundary refuses any incomplete journal.
export async function listPrivacyJournal({ env = process.env, fetchImpl = fetch } = {}) {
  const config = privateBackupStorageConfig(env);
  if (!config) throw Object.assign(new Error("Private backup storage is not configured."), { code: "PRIVACY_JOURNAL_UNAVAILABLE" });
  const sign = signer(env);
  const keys = [];
  const seenTokens = new Set();
  let pages = 0;
  let token = null;
  do {
    if (++pages > MAX_LIST_PAGES) throw journalError();
    const url = new URL(bucketUrl(config));
    url.searchParams.set("list-type", "2");
    url.searchParams.set("prefix", PRIVACY_JOURNAL_PREFIX);
    if (token) url.searchParams.set("continuation-token", token);
    const response = await fetchImpl(sign("GET", url.href), { method: "GET", redirect: "manual", signal: AbortSignal.timeout(20_000) });
    if (!response.ok) {
      await discard(response);
      throw Object.assign(new Error(`Privacy journal listing failed: HTTP ${response.status}`), { code: "PRIVACY_JOURNAL_UNAVAILABLE" });
    }
    const xml = await limitedText(response, 4 * 1024 * 1024);
    // A 200 error page or a truncated XML response is not an empty bucket.
    // Require the S3 envelope and complete Contents/Key pairs before trusting
    // the listing. The configured S3 endpoint is the only XML producer.
    if (!/^(?:<\?xml[^?]*\?>\s*)?<ListBucketResult(?:\s[^>]*)?>[\s\S]*<\/ListBucketResult>$/u.test(xml.trim())
      || [...xml.matchAll(/<IsTruncated>(?:true|false)<\/IsTruncated>/gu)].length !== 1
      || /<!DOCTYPE|<!ENTITY/iu.test(xml)) throw journalError();
    const contents = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/gu)];
    if (contents.length !== [...xml.matchAll(/<Contents(?:\s|>)/gu)].length
      || contents.length !== [...xml.matchAll(/<Key(?:\s|>)/gu)].length) throw journalError();
    for (const content of contents) {
      const matches = [...content[1].matchAll(/<Key>([^<]+)<\/Key>/gu)];
      if (matches.length !== 1) throw journalError();
      const objectKey = xmlText(matches[0][1]);
      if (!objectKey.startsWith(PRIVACY_JOURNAL_PREFIX) || !objectKey.endsWith(".json") || objectKey.length > 1024) throw journalError();
      keys.push(objectKey);
    }
    const truncated = /<IsTruncated>true<\/IsTruncated>/u.test(xml);
    token = truncated ? xmlText(xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/u)?.[1] || "") || null : null;
    if (truncated && !token) throw Object.assign(new Error("Privacy journal listing lost its place."), { code: "PRIVACY_JOURNAL_UNAVAILABLE" });
    if (token && (token.length > 4096 || seenTokens.has(token))) throw journalError();
    if (token) seenTokens.add(token);
    if (keys.length > MAX_OBJECTS) throw Object.assign(new Error("Privacy journal is larger than expected."), { code: "PRIVACY_JOURNAL_UNAVAILABLE" });
  } while (token);
  const entries = [];
  let unreadable = 0;
  for (const key of keys.filter((name) => name.endsWith(".json"))) {
    const response = await fetchImpl(sign("GET", bucketUrl(config, key)), { method: "GET", redirect: "manual", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) {
      await discard(response);
      throw Object.assign(new Error(`Privacy journal object failed: HTTP ${response.status}`), { code: "PRIVACY_JOURNAL_UNAVAILABLE" });
    }
    try { entries.push(JSON.parse(await limitedText(response, MAX_OBJECT_BYTES))); }
    catch { unreadable += 1; }
  }
  return { entries, unreadable };
}

// Validate the complete journal BEFORE any mutation. A damaged or old-key
// entry may be the only evidence of an erasure, so skipping it is not recovery.
// Applies verified entries, oldest first, once each. `erase(accountId)` and
// `optOut(accountId)` return true when they changed something and false when
// the account is not in this database (already gone, or created later).
export function replayPrivacyEntries({ entries, key, erase, optOut }) {
  const counts = { entries: entries.length, verified: 0, rejected: 0, erased: 0, optedOut: 0, absent: 0, newestAt: null };
  const seen = new Map();
  const verified = [];
  for (const entry of entries) {
    if (!verifyPrivacyEntry(entry, key)) throw journalError();
    const previous = seen.get(entry.id);
    if (previous !== undefined) {
      if (previous !== canonical(entry)) throw journalError();
      continue;
    }
    seen.set(entry.id, canonical(entry));
    verified.push(entry);
  }
  verified.sort((left, right) => left.at - right.at || (left.id < right.id ? -1 : 1));
  for (const entry of verified) {
    counts.verified += 1;
    counts.newestAt = entry.at;
    const changed = entry.kind === "account_erased" ? erase(entry.subjectId) : optOut(entry.subjectId);
    if (!changed) counts.absent += 1;
    else if (entry.kind === "account_erased") counts.erased += 1;
    else counts.optedOut += 1;
  }
  return counts;
}

function readJson(database, key) {
  try { return JSON.parse(database.prepare("SELECT value FROM app_meta WHERE key=?").get(key)?.value || "null"); }
  catch { return null; } // architecture: allow-ambiguous-result -- malformed evidence reads as missing, which requires a replay
}

// A database prepared from a backup (scripts/prepare-db-restore.mjs) that has
// not yet replayed the journal. Live databases never carry a restore gate.
export function restoredDatabaseNeedsReplay(database, env = process.env) {
  const gate = readJson(database, RESTORE_GATE_KEY);
  if (gate?.state !== "reviewed" || !Number.isSafeInteger(gate.preparedAt)) return null;
  const evidence = readJson(database, PRIVACY_REPLAY_EVIDENCE_KEY);
  if (evidence?.version !== 1 || evidence.preparedAt !== gate.preparedAt
    || !Number.isSafeInteger(evidence.replayedAt) || evidence.replayedAt < gate.preparedAt) return gate;
  if (typeof evidence.waived === "string" && REFERENCE.test(evidence.waived)) return null;
  // Older releases recorded success even when some entries could not be read
  // or verified. Such receipts must not bypass the repaired startup gate.
  const counts = ["entries", "verified", "erased", "optedOut", "absent"];
  if (evidence.verificationVersion !== 3 || evidence.storageIdentity !== backupStorageIdentity(env)
    || !evidence.storageIdentity || evidence.continuityVerified !== true || evidence.rejected !== 0 || evidence.unreadable !== 0
    || !counts.every((field) => Number.isSafeInteger(evidence[field]) && evidence[field] >= 0)
    || evidence.entries < evidence.verified
    || evidence.verified !== evidence.erased + evidence.optedOut + evidence.absent
    || (evidence.verified === 0 ? evidence.newestAt !== null : !Number.isSafeInteger(evidence.newestAt) || evidence.newestAt < 1)) return gate;
  return null;
}

function saveEvidence(database, evidence) {
  database.prepare("INSERT INTO app_meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(PRIVACY_REPLAY_EVIDENCE_KEY, JSON.stringify(evidence));
}

// Before a restored database serves traffic: replay the journal and record
// the evidence. If the journal cannot be read, startup stops, unless the
// owner sets PRIVACY_JOURNAL_REPLAY_WAIVER to an incident reference after
// deciding that recovery without it is acceptable; the waiver is recorded.
export async function replayPrivacyJournalIfRestored(database, { env = process.env, fetchImpl = fetch, erase, optOut, now = Date.now } = {}) {
  env = { ...env };
  const deadline = AbortSignal.timeout(5 * MINUTE);
  const transport = fetchImpl;
  fetchImpl = (url, options) => transport(url, { ...options, signal: AbortSignal.any([deadline, options.signal].filter(Boolean)) });
  const gate = restoredDatabaseNeedsReplay(database, env);
  if (!gate) return { needed: false };
  const base = { version: 1, verificationVersion: 3, preparedAt: gate.preparedAt, replayedAt: now() };
  try {
    const key = privacyJournalKey(env);
    if (!key) throw Object.assign(new Error("PRIVACY_JOURNAL_KEY is not set."), { code: "PRIVACY_JOURNAL_UNAVAILABLE" });
    const { entries, unreadable } = await listPrivacyJournal({ env, fetchImpl });
    if (unreadable !== 0) throw journalError();
    if (!entries.every((entry) => verifyPrivacyEntry(entry, key))) throw journalError();
    const coverage = await readCoverage({ env, fetchImpl, key });
    const identity = backupStorageIdentity(env);
    if (coverage.storageIdentity !== identity || !verifyContinuityChain(entries, coverage, readContinuity(database))) {
      throw journalError("PRIVACY_JOURNAL_CONTINUITY_UNKNOWN");
    }
    const counts = replayPrivacyEntries({ entries, key, erase, optOut });
    const evidence = { ...base, ...counts, unreadable, storageIdentity: identity, continuityVerified: true,
      streamId: coverage.streamId, coverageSequence: coverage.sequence };
    saveEvidence(database, evidence);
    return { needed: true, ...evidence };
  } catch (error) {
    const waiver = String(env.PRIVACY_JOURNAL_REPLAY_WAIVER || "").trim();
    if (!REFERENCE.test(waiver)) {
      throw Object.assign(new Error(`This database was restored from a backup and the privacy journal could not be replayed (${error?.code || "error"}). Fix the journal access, or set PRIVACY_JOURNAL_REPLAY_WAIVER to an incident reference after an owner decision.`),
        { code: "PRIVACY_JOURNAL_REPLAY_REQUIRED" });
    }
    const evidence = { ...base, waived: waiver, reason: String(error?.code || "error").slice(0, 60) };
    saveEvidence(database, evidence);
    return { needed: true, ...evidence };
  }
}

export function privacyJournalStatus(database, env = process.env) {
  const identity = backupStorageIdentity(env);
  const predicate = "(shipped_at IS NULL OR shipped_storage_identity IS NULL OR shipped_storage_identity<>?)";
  const row = database.prepare("SELECT COUNT(*) AS pending, MIN(at) AS oldest FROM privacy_journal_outbox WHERE " + predicate).get(identity || "");
  const last = database.prepare("SELECT MAX(shipped_at) AS at FROM privacy_journal_outbox WHERE shipped_storage_identity=?").get(identity || "");
  const failure = database.prepare("SELECT last_error FROM privacy_journal_outbox WHERE " + predicate + " AND last_error IS NOT NULL ORDER BY at LIMIT 1").get(identity || "");
  const state = readContinuity(database);
  const continuityStatus = !state ? "uninitialized" : state.legacyUnknown ? "legacy_unknown"
    : !state.storageIdentity ? "uninitialized" : state.storageIdentity !== identity ? "destination_changed" : "ready";
  return {
    signingKey: !!privacyJournalKey(env), storage: !!identity,
    continuityReady: continuityStatus === "ready", continuityStatus,
    pending: Number(row?.pending) || 0, oldestPendingAt: row?.oldest ?? null,
    lastShippedAt: last?.at ?? null, lastError: failure?.last_error || state?.lastError || null,
    lastReplay: readJson(database, PRIVACY_REPLAY_EVIDENCE_KEY),
  };
}

export function startPrivacyJournalShipper({ database, env = process.env, fetchImpl = fetch, logger = console } = {}) {
  if (!privacyJournalKey(env)) {
    logger.warn?.("[privacy-journal] PRIVACY_JOURNAL_KEY is not set: erasures and opt-outs are kept on this server but not copied off-host yet.");
  }
  return startPeriodicJob({
    initialDelayMs: MINUTE,
    intervalMs: 5 * MINUTE,
    run: async ({ signal }) => {
      const result = await shipPrivacyJournal(database, { env, fetchImpl, signal });
      if (result.error) logger.error?.(`[privacy-journal] shipping paused: ${result.error}; ${result.pending} entries waiting`);
      return true;
    },
    report: (error) => logger.error?.(`[privacy-journal] shipping failed safely: ${privateErrorLabel(error)}`),
  });
}
