import { catalogBatchStorageKey } from "../../domain/accountLocalPrivacy.mjs";

const clone = value => JSON.parse(JSON.stringify(value));
const identity = draft => JSON.stringify([draft.type, draft.key]);
const locked = entry => ["sending", "uncertain"].includes(entry.status);
const LIMIT = 10, MAX_BYTES = 600_000, RETRY_WINDOW = 7 * 86400_000;
const operationKey = () => `catalog_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;

export function currentCatalogTextMatches(receipt, draft, text) {
  if (draft.hidden) return text === null;
  return !!text && text.revision === receipt.revision && text.summary === draft.summary
    && JSON.stringify(text.sources) === JSON.stringify(draft.sources);
}

// A single mounted/account-keyed editor owns this controller. Cross-tab revisions
// are checked before every mutation; server revision checks remain authoritative.
export function createCatalogBatch({ accountId, storage, now = Date.now, newKey = operationKey }) {
  const key = catalogBatchStorageKey(accountId);
  if (!key) throw new Error("Sign in before opening a catalog batch.");
  let raw = storage.getItem(key), state;
  if (raw) {
    if (raw.length > MAX_BYTES) throw new Error("The saved catalog batch is too large. No changes were made.");
    try { state = JSON.parse(raw); } catch { throw new Error("The saved catalog batch cannot be read. No changes were made."); }
    if (state.version !== 1 || state.accountId !== String(accountId) || !Array.isArray(state.entries) || state.entries.length > LIMIT
      || !Array.isArray(state.receipts) || state.receipts.length > 20 || state.entries.some(entry => !entry?.draft
        || !["artist", "venue", "event"].includes(entry.draft.type) || typeof entry.draft.key !== "string"
        || !/^[A-Za-z0-9_-]{16,100}$/u.test(entry.id || "") || !["draft", "reviewed", "sending", "uncertain", "conflict"].includes(entry.status))) {
      throw new Error("The saved catalog batch is invalid. No changes were made.");
    }
    state.entries = state.entries.map(entry => ({ ...entry, status: locked(entry) ? "uncertain" : "draft", review: null }));
  } else state = { version: 1, accountId: String(accountId), entries: [], receipts: [] };
  const get = () => clone(state);
  const persist = next => {
    if (storage.getItem(key) !== raw) throw new Error("This batch changed in another window or the account signed out. Reopen the editor before continuing.");
    const encoded = JSON.stringify(next);
    if (encoded.length > MAX_BYTES) throw new Error("The catalog batch storage limit was reached.");
    storage.setItem(key, encoded);
    if (storage.getItem(key) !== encoded) throw new Error("The batch could not be saved durably. Publication was stopped.");
    raw = encoded; state = next;
    return get();
  };
  const stage = draft => {
    const existing = state.entries.find(entry => identity(entry.draft) === identity(draft));
    if (existing && locked(existing)) throw new Error("Resolve the uncertain save before editing this entry.");
    const entries = state.entries.filter(entry => entry !== existing);
    if (entries.length >= LIMIT) throw new Error("Review and save this batch before adding more pages.");
    return persist({ ...state, entries: [...entries, { id: newKey(), draft: clone(draft), status: "draft", review: null }] });
  };
  const remove = id => {
    if (state.entries.some(entry => (id == null || entry.id === id) && locked(entry))) throw new Error("Resolve the uncertain save before removing this entry.");
    return persist({ ...state, entries: id == null ? [] : state.entries.filter(entry => entry.id !== id) });
  };
  const review = results => {
    if (state.entries.some(locked)) throw new Error("Retry the uncertain save before reviewing other entries.");
    if (results.length !== state.entries.length) throw new Error("The review did not match this batch.");
    return persist({ ...state, entries: state.entries.map((entry, index) => {
      const row = results[index];
      if (row.index !== index || (row.ok && identity(row.draft) !== identity(entry.draft))) throw new Error("The review returned a different catalog identity.");
      return { ...entry, draft: row.ok ? row.draft : entry.draft, status: row.ok ? "reviewed" : "conflict", review: row };
    }) });
  };
  const publish = async ({ service, signal, current = () => true, id = null, onChange = () => {}, onReceipt = () => {} }) => {
    const active = () => {
      if (signal?.aborted || !current()) throw new Error("The account or editor changed. Publication stopped.");
    };
    const commit = next => { active(); const snapshot = persist(next); onChange(snapshot); };
    active();
    const entries = state.entries.filter(entry => id == null || entry.id === id);
    if (!entries.length || entries.some(entry => !["reviewed", "uncertain"].includes(entry.status))
      || (id == null && entries.some(locked)) || (id != null && state.entries.some(entry => entry.id !== id && locked(entry)))) {
      throw new Error("Review this batch, or retry its uncertain save, before publishing.");
    }
    for (const planned of entries) {
      active();
      const entry = state.entries.find(value => value.id === planned.id);
      if (entry.attemptedAt != null && now() - entry.attemptedAt >= RETRY_WINDOW) throw new Error("This uncertain save is outside the seven-day receipt window. Review its audit record before any further change.");
      // Persist the exact key and normalized body BEFORE issuing the request.
      const sending = { ...entry, status: "sending", attemptedAt: entry.attemptedAt ?? now() };
      commit({ ...state, entries: state.entries.map(value => value.id === entry.id ? sending : value) });
      let receipt;
      try {
        receipt = await service.save(entry.draft, entry.id, signal);
        active();
        if (!receipt?.ok || receipt.saved?.type !== entry.draft.type || receipt.saved?.key !== entry.draft.key
          || !Number.isSafeInteger(receipt.revision) || !receipt.auditId) throw new Error("The save response was incomplete. Retry with the saved receipt key.");
      } catch (error) {
        if (current() && !signal?.aborted) {
          // A later rejection can occur before receipt lookup. It cannot disprove
          // a commit from the original timed-out request.
          // The API can also raise a client-side 409 *after* a successful HTTP
          // response when its account generation changes. HTTP status alone is
          // therefore insufficient evidence of a precommit rejection.
          const definite = entry.status !== "uncertain" && ((error.status === 409 && error.serverCode === "CONFLICT")
            || (error.status === 400 && error.serverCode === "VALIDATION_FAILED"));
          commit({ ...state, entries: state.entries.map(value => value.id === entry.id ? { ...sending, status: definite ? "conflict" : "uncertain", error: error.message } : value) });
        }
        throw error;
      }
      const record = { id: entry.id, draft: entry.draft,
        receipt: { revision: receipt.revision, auditId: receipt.auditId, replayed: receipt.replayed === true },
        recordedAt: now(), verification: "unverified" };
      commit({ ...state, entries: state.entries.filter(value => value.id !== entry.id), receipts: [...state.receipts, record].slice(-20) });
      onReceipt(receipt);
      // Receipt replay proves a historical commit, never current public visibility.
      const response = await service.publicText({ ...entry.draft, signal });
      active();
      const verified = currentCatalogTextMatches(receipt, entry.draft, response?.text);
      commit({ ...state, receipts: state.receipts.map(value => value.id === entry.id ? { ...value, verification: verified ? "verified" : "changed", verifiedAt: now() } : value) });
      if (!verified) throw new Error("A save receipt was recovered, but current public text differs. Publication stopped; review this page.");
    }
    return get();
  };
  return { get, stage, remove, review, publish };
}
