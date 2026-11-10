import { mergeChatMessages } from "./chatMessages.mjs";

const EMPTY = Object.freeze({ messages: [], nextCursor: null, initialized: false, loading: false, error: false, unavailable: false });
const cancelled = () => Object.assign(new Error("Cancelled"), { name: "AbortError" });
export const isMessageHistoryAccessError = (error) => [401, 403, 404].includes(Number(error?.status));
const sameRows = (left, right) => left.length === right.length && left.every((row, index) => {
  const other = right[index];
  return Object.keys(row).length === Object.keys(other).length
    && Object.keys(row).every((key) => Object.is(row[key], other[key]));
});

// This owner belongs to one mounted account/epoch/thread. The Store keeps its
// bounded recent cache; pages explicitly opened here survive later cache trims.
// No authored body is persisted. Tombstones also cover older in-flight pages.
export function createDirectMessageHistory({ isCurrent = () => true } = {}) {
  let snapshot = EMPTY, generation = 0, alive = true, flight = null;
  const listeners = new Set(), removed = new Set();
  const current = () => alive && isCurrent();
  const publish = (value) => {
    snapshot = Object.freeze(value);
    for (const listener of listeners) listener();
  };
  const merge = (rows, incoming) => mergeChatMessages(rows, incoming, [...removed], Number.MAX_SAFE_INTEGER);
  const receive = (result, { after = null, before = null } = {}) => {
    if (!current() || result?.stale || !Array.isArray(result?.messages)) return false;
    for (const id of result.removedIds || []) removed.add(id);
    // A previously denied owner needs a fresh authorized head before restoring
    // visibility. An incremental response cannot establish complete history.
    if (snapshot.unavailable && (after || before)) return false;
    const head = !after && !before;
    const nextCursor = before || (head && !snapshot.initialized)
      ? (result.nextCursor || null) : snapshot.nextCursor;
    publish({ ...snapshot, messages: merge(snapshot.messages, result.messages), nextCursor,
      initialized: snapshot.initialized || head, unavailable: false });
    return true;
  };
  const deny = () => {
    if (!current()) return;
    generation += 1;
    flight?.controller.abort(); flight = null;
    removed.clear();
    publish({ ...EMPTY, unavailable: true });
  };
  return {
    read: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    activate() { alive = true; },
    dispose() {
      alive = false; generation += 1; flight?.controller.abort(); flight = null;
      removed.clear(); snapshot = EMPTY;
    },
    receive,
    deny,
    remember(live) {
      if (!current() || snapshot.unavailable) return;
      const messages = merge(snapshot.messages, (live || []).filter((row) => row.server && !row.pending && !row.failed));
      if (!sameRows(snapshot.messages, messages)) publish({ ...snapshot, messages });
    },
    display(live) { return current() && !snapshot.unavailable ? merge(snapshot.messages, live) : []; },
    loadEarlier({ load, beforeCommit = () => {} }) {
      if (!current() || snapshot.unavailable || !snapshot.initialized || !snapshot.nextCursor) return Promise.resolve(null);
      if (flight) return flight.promise;
      const request = { controller: new AbortController(), generation, cursor: snapshot.nextCursor, promise: null };
      flight = request;
      const accepted = () => current() && generation === request.generation && !request.controller.signal.aborted && flight === request;
      publish({ ...snapshot, loading: true, error: false });
      request.promise = Promise.resolve().then(async () => {
        if (!accepted()) throw cancelled();
        const result = await load({ before: request.cursor, signal: request.controller.signal, strict: true, includeContext: false });
        if (!accepted() || result?.stale) throw cancelled();
        if (!Array.isArray(result?.messages) || result.nextCursor === request.cursor) throw new Error("Earlier messages could not be loaded.");
        beforeCommit();
        receive(result, { before: request.cursor });
        return result;
      }).catch((error) => {
        if (accepted() && error?.name !== "AbortError") {
          if (isMessageHistoryAccessError(error)) deny();
          else publish({ ...snapshot, error: true });
        }
        // The UI owns retry and keeps the same cursor. Abandoned reads have no
        // visible failure and cannot populate a replacement history owner.
        return null;
      }).finally(() => {
        if (flight === request) {
          flight = null;
          if (current()) publish({ ...snapshot, loading: false });
        }
      });
      return request.promise;
    },
  };
}

// Native ScrollView keeps a visible child anchored. Web lacks that contract:
// preserve one measured row, so simultaneous appends do not affect the offset.
export function createDirectMessageHistoryAnchor({ web = false, isCurrent = () => true, scrollTo = () => {} } = {}) {
  const rows = new Map();
  let offset = 0, anchor = null, prepending = false;
  return {
    onScroll(event) {
      if (!isCurrent()) return;
      offset = event.nativeEvent.contentOffset.y;
    },
    rowLayout(id, event) {
      if (!isCurrent()) return;
      const y = event.nativeEvent.layout.y;
      if (!Number.isFinite(y)) return;
      rows.set(id, y);
      if (anchor?.id === id) {
        offset = Math.max(0, anchor.offset + y - anchor.y);
        anchor = null;
        scrollTo({ y: offset, animated: false });
      }
    },
    prepare(messageIds) {
      if (!isCurrent()) return;
      prepending = true;
      if (!web) return;
      const visible = messageIds.map((id) => ({ id, y: rows.get(id) })).filter((row) => Number.isFinite(row.y));
      const target = visible.find((row) => row.y >= offset) || visible.at(-1);
      anchor = target ? { ...target, offset } : null;
    },
    contentChanged() {
      if (!isCurrent() || !prepending) return false;
      if (!web || !anchor) prepending = false;
      return true;
    },
  };
}
