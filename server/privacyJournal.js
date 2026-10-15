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

function journalError(code = "PRIVACY_JOURNAL_INVALID") {
  return Object.assign(new Error("Privacy journal verification did not complete."), { code });
}

export function ensurePrivacyJournalSchema(database) {
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
}

// Call inside the transaction that makes the change, so the two commit together.
export function recordPrivacyEvent(database, { kind, subjectId, at = Date.now(), id = randomUUID() } = {}) {
  if (!KINDS.has(kind) || !SUBJECT.test(String(subjectId || "")) || !ENTRY_ID.test(id) || !Number.isSafeInteger(at) || at < 1) {
    throw new TypeError("Invalid privacy journal entry.");
  }
  database.prepare("INSERT INTO privacy_journal_outbox (id,kind,subject_id,at) VALUES (?,?,?,?)").run(id, kind, subjectId, at);
  return id;
}

// PRIVACY_JOURNAL_KEY signs entries. Keep it only in the server environment,
// never in the database or the bucket. Preserve historical verification while
// any corresponding journal entry or backup remains recoverable. A fresh backup
// alone is not a safe key-rotation procedure. See SECURITY.md.
export function privacyJournalKey(env = process.env) {
  const value = String(env.PRIVACY_JOURNAL_KEY || "").trim();
  return value.length >= 32 ? Buffer.from(value, "utf8") : null;
}

const canonical = (entry) => JSON.stringify([1, entry.id, entry.kind, entry.subjectId, entry.at]);
const mac = (entry, key) => createHmac("sha256", key).update(canonical(entry)).digest("hex");

export function signPrivacyEntry(entry, key) {
  const plain = { v: 1, id: entry.id, kind: entry.kind, subjectId: entry.subjectId, at: entry.at };
  return { ...plain, mac: mac(plain, key) };
}

export function verifyPrivacyEntry(entry, key) {
  if (!key || entry?.v !== 1 || !KINDS.has(entry?.kind)
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
export async function shipPrivacyJournal(database, { env = process.env, fetchImpl = fetch, now = Date.now, limit = 50, signal } = {}) {
  signal?.throwIfAborted();
  const request = (url, options) => fetchImpl(url, {
    ...options,
    signal: signal ? AbortSignal.any([signal, options.signal].filter(Boolean)) : options.signal,
  });
  const pending = Number(database.prepare("SELECT COUNT(*) AS n FROM privacy_journal_outbox WHERE shipped_at IS NULL").get().n) || 0;
  const key = privacyJournalKey(env);
  const config = privateBackupStorageConfig(env);
  if (!pending) return { shipped: 0, pending: 0, waiting: null };
  if (!key) return { shipped: 0, pending, waiting: "key" };
  if (!config) return { shipped: 0, pending, waiting: "storage" };
  const rows = database.prepare(`SELECT id,kind,subject_id,at FROM privacy_journal_outbox WHERE shipped_at IS NULL
    ORDER BY at,id LIMIT ?`).all(Math.max(1, Math.min(200, limit)));
  const sign = signer(env);
  const markShipped = database.prepare("UPDATE privacy_journal_outbox SET shipped_at=?,last_error=NULL WHERE id=?");
  const markFailed = database.prepare("UPDATE privacy_journal_outbox SET attempts=attempts+1,last_error=? WHERE id=?");
  let shipped = 0;
  try {
    // The same anonymous-access proof the database backups use.
    await verifyPrivateBackupBucket({ env, fetchImpl: request, objectKey: `${PRIVACY_JOURNAL_PREFIX}privacy-probe-${randomUUID()}` });
  } catch {
    signal?.throwIfAborted();
    markFailed.run("storage_not_private", rows[0].id);
    return { shipped: 0, pending, waiting: null, error: "storage_not_private" };
  }
  for (const row of rows) {
    signal?.throwIfAborted();
    const entry = signPrivacyEntry({ id: row.id, kind: row.kind, subjectId: row.subject_id, at: row.at }, key);
    const body = JSON.stringify(entry);
    const headers = { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)) };
    let response;
    try {
      response = await request(sign("PUT", bucketUrl(config, privacyObjectKey(entry)), headers), {
        method: "PUT", headers, body, redirect: "manual", signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`HTTP_${Number(response.status) || 0}`);
    } catch (error) {
      signal?.throwIfAborted();
      const code = /^HTTP_\d+$/u.test(error?.message) ? error.message : "network_error";
      markFailed.run(code, row.id);
      return { shipped, pending: pending - shipped, waiting: null, error: code };
    } finally {
      await discard(response);
    }
    signal?.throwIfAborted();
    markShipped.run(now(), row.id);
    shipped += 1;
  }
  database.prepare("DELETE FROM privacy_journal_outbox WHERE shipped_at IS NOT NULL AND shipped_at<?").run(now() - SHIPPED_RETENTION_MS);
  return { shipped, pending: pending - shipped, waiting: null };
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
export function restoredDatabaseNeedsReplay(database) {
  const gate = readJson(database, RESTORE_GATE_KEY);
  if (gate?.state !== "reviewed" || !Number.isSafeInteger(gate.preparedAt)) return null;
  const evidence = readJson(database, PRIVACY_REPLAY_EVIDENCE_KEY);
  if (evidence?.version !== 1 || evidence.preparedAt !== gate.preparedAt
    || !Number.isSafeInteger(evidence.replayedAt) || evidence.replayedAt < gate.preparedAt) return gate;
  if (typeof evidence.waived === "string" && REFERENCE.test(evidence.waived)) return null;
  // Older releases recorded success even when some entries could not be read
  // or verified. Such receipts must not bypass the repaired startup gate.
  const counts = ["entries", "verified", "erased", "optedOut", "absent"];
  if (evidence.verificationVersion !== 2 || evidence.rejected !== 0 || evidence.unreadable !== 0
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
  const gate = restoredDatabaseNeedsReplay(database);
  if (!gate) return { needed: false };
  const base = { version: 1, verificationVersion: 2, preparedAt: gate.preparedAt, replayedAt: now() };
  try {
    const key = privacyJournalKey(env);
    if (!key) throw Object.assign(new Error("PRIVACY_JOURNAL_KEY is not set."), { code: "PRIVACY_JOURNAL_UNAVAILABLE" });
    const { entries, unreadable } = await listPrivacyJournal({ env, fetchImpl });
    if (unreadable !== 0) throw journalError();
    const counts = replayPrivacyEntries({ entries, key, erase, optOut });
    const evidence = { ...base, ...counts, unreadable };
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
  const row = database.prepare(`SELECT COUNT(*) AS pending, MIN(at) AS oldest FROM privacy_journal_outbox WHERE shipped_at IS NULL`).get();
  const last = database.prepare("SELECT MAX(shipped_at) AS at FROM privacy_journal_outbox").get();
  const failure = database.prepare(`SELECT last_error FROM privacy_journal_outbox WHERE shipped_at IS NULL AND last_error IS NOT NULL
    ORDER BY at LIMIT 1`).get();
  return {
    signingKey: !!privacyJournalKey(env),
    storage: !!privateBackupStorageConfig(env),
    pending: Number(row?.pending) || 0,
    oldestPendingAt: row?.oldest ?? null,
    lastShippedAt: last?.at ?? null,
    lastError: failure?.last_error || null,
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
    report: (error) => logger.error?.(`[privacy-journal] shipping failed safely: ${String(error?.message || error).slice(0, 120)}`),
  });
}
