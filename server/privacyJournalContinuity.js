import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const CONTINUITY_KEY = "privacy-journal:continuity:v1";
export const COVERAGE_OBJECT = "privacy-journal/coverage-v1.json";
export const EMPTY_HEAD = "0".repeat(64);
const HEX = /^[a-f0-9]{64}$/u;
const STREAM = /^[a-f0-9-]{36}$/u;

export const canonicalPrivacyEntry = (entry) => entry.v === 2
  ? JSON.stringify([2, entry.id, entry.kind, entry.subjectId, entry.at, entry.streamId, entry.sequence, entry.previous])
  : JSON.stringify([1, entry.id, entry.kind, entry.subjectId, entry.at]);
export const privacyEntryHead = (entry) => createHash("sha256").update(canonicalPrivacyEntry(entry)).digest("hex");
export function validChainFields(value) {
  return STREAM.test(value?.streamId) && Number.isSafeInteger(value?.sequence) && value.sequence >= 1 && HEX.test(value?.previous);
}
export function readContinuity(database) {
  try {
    const state = JSON.parse(database.prepare("SELECT value FROM app_meta WHERE key=?").get(CONTINUITY_KEY)?.value || "null");
    if (state?.version !== 1 || !STREAM.test(state.streamId) || !HEX.test(state.head) || !HEX.test(state.shippedHead)
      || !Number.isSafeInteger(state.sequence) || state.sequence < 0
      || !Number.isSafeInteger(state.shippedSequence) || state.shippedSequence < 0 || state.shippedSequence > state.sequence
      || typeof state.legacyUnknown !== "boolean"
      || (state.storageIdentity !== null && !HEX.test(state.storageIdentity))) return null;
    return state;
  } catch { return null; } // architecture: allow-ambiguous-result -- absent or malformed continuity cannot authorize recovery
}
export function writeContinuity(database, state) {
  database.prepare("INSERT INTO app_meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(CONTINUITY_KEY, JSON.stringify(state));
}
const canonicalCoverage = (value) => JSON.stringify([1, value.storageIdentity, value.streamId, value.sequence, value.head, value.legacyUnknown, value.at]);
export function signCoverage(value, key) {
  const plain = { v: 1, storageIdentity: value.storageIdentity, streamId: value.streamId,
    sequence: value.sequence, head: value.head, legacyUnknown: value.legacyUnknown, at: value.at };
  return { ...plain, mac: createHmac("sha256", key).update(canonicalCoverage(plain)).digest("hex") };
}
export function verifyCoverage(value, key) {
  if (!key || value?.v !== 1 || !HEX.test(value.storageIdentity) || !STREAM.test(value.streamId)
    || !Number.isSafeInteger(value.sequence) || value.sequence < 0 || !HEX.test(value.head)
    || typeof value.legacyUnknown !== "boolean" || !Number.isSafeInteger(value.at) || value.at < 1 || !HEX.test(value.mac)) return false;
  const expected = createHmac("sha256", key).update(canonicalCoverage(value)).digest();
  return timingSafeEqual(Buffer.from(value.mac, "hex"), expected);
}

// A complete chain from genesis covers every retained snapshot in the stream,
// including events pruned from the live outbox. A count or empty listing alone
// is never proof. This helper is called only after every entry MAC is checked.
export function verifyContinuityChain(entries, coverage, anchor) {
  if (!anchor || anchor.legacyUnknown || coverage.legacyUnknown || coverage.streamId !== anchor.streamId
    || coverage.sequence < anchor.sequence) return false;
  const ordered = entries.slice().sort((a, b) => a.sequence - b.sequence);
  if (ordered.length !== coverage.sequence) return false;
  let head = EMPTY_HEAD;
  if (anchor.sequence === 0 && anchor.head !== head) return false;
  for (let index = 0; index < ordered.length; index += 1) {
    const entry = ordered[index];
    if (entry.v !== 2 || entry.streamId !== anchor.streamId || entry.sequence !== index + 1 || entry.previous !== head) return false;
    head = privacyEntryHead(entry);
    if (entry.sequence === anchor.sequence && head !== anchor.head) return false;
  }
  return head === coverage.head;
}
