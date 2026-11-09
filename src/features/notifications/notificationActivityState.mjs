import * as pageLoad from "./notificationPageLoad.mjs";
import * as readCommand from "./notificationReadCommand.mjs";
import { beginLoadState, createLoadState, isLoadCancellation, rejectLoadState, resolveLoadState } from "../../domain/loadState.mjs";
import { commandFailure } from "../../domain/commandResult.mjs";
import { createScopedReadCoordinator } from "../../domain/scopedReadCoordinator.mjs";

export const NOTIFICATION_READ_CONTRACT = "notification-ids-v1";
export const MAX_NOTIFICATION_ROWS = 1000;
const emptyData = () => ({ rows: [], unread: null, nextCursor: null, readContract: null, historyLimited: false });
const aborted = () => Object.assign(new Error("Activity request is no longer current."), { name: "AbortError" });
const ownerKey = ({ accountId, epoch, ready }) => JSON.stringify([accountId || null, epoch || 0, !!ready]);
const unreadRows = rows => rows.filter(row => !row.read).length;
const welcomeUnread = rows => unreadRows(rows.filter(row => row.type === "welcome"));
const uniqueRows = rows => [...new Map(rows.map(row => [String(row.id), row])).values()]
  .sort((a, b) => b.ts - a.ts || String(b.id).localeCompare(String(a.id)));

// A caller's cancellation retires only that observer, not a shared account read.
function observe(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    const cancel = () => reject(aborted());
    signal.addEventListener("abort", cancel, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", cancel));
  });
}

// Private account+auth-epoch memory cache only. At most 1,000 rows; refresh resets
// paging. No disk persistence. Concurrent reads deduplicate and all network
// reads/acks serialize within an epoch, so an earlier GET cannot undo a later
// confirmed read. Scope changes abort and synchronously discard everything.
export function createNotificationActivity({ getIdentity, getHiddenActorIds = () => [], fetchPage, writeReads, makeError, normalizeError, loadReadCommand = async () => readCommand, loadPageCommand = async () => pageLoad, now = Date.now, demo = false, seed = [] }) {
  const coordinator = createScopedReadCoordinator(ownerKey);
  const listeners = new Set();
  let owner = getIdentity(), scope = ownerKey(owner), alive = true;
  let resource = createLoadState({ scope, data: emptyData() });
  let tail = Promise.resolve(), operations = new Map(), mutationRevision = 0, writeSequence = 0;
  const emit = () => { for (const listener of listeners) listener(); };
  const publish = next => { resource = next; emit(); };
  const cancelOperations = () => {
    for (const operation of operations.values()) operation.controller.abort();
    operations = new Map(); tail = Promise.resolve(); coordinator.reset();
  };
  const sync = () => {
    const nextOwner = getIdentity(), nextScope = ownerKey(nextOwner);
    if (scope !== nextScope) {
      cancelOperations(); owner = nextOwner; scope = nextScope;
      resource = createLoadState({ scope, data: emptyData() });
      mutationRevision += 1;
    } else owner = nextOwner;
    return scope;
  };
  const valid = expected => alive && sync() === expected && owner.accountId && owner.ready;
  const requireScope = expected => { if (!valid(expected)) throw aborted(); };
  const enqueue = (key, expected, task) => {
    requireScope(expected);
    if (operations.has(key)) return operations.get(key).promise;
    const operation = { controller: new AbortController(), promise: null };
    const queue = tail;
    operation.promise = queue.then(async () => {
      requireScope(expected);
      if (operation.controller.signal.aborted) throw aborted();
      return task(operation.controller.signal);
    }).finally(() => { if (operations.get(key) === operation) operations.delete(key); });
    operations.set(key, operation);
    // Each caller receives its own failure; the queue continues without an
    // unhandled rejection after a failed operation.
    tail = operation.promise.then(() => undefined, () => undefined);
    return operation.promise;
  };
  const load = ({ expectedScope = sync(), accountId, signal, more = false, summary = false } = {}) => {
    try { requireScope(expectedScope); } catch (error) { return Promise.reject(error); }
    if (accountId && accountId !== owner.accountId) return Promise.reject(aborted());
    if (signal?.aborted) return Promise.reject(aborted());
    if (summary && operations.has("head")) return observe(operations.get("head").promise, signal);
    const cursor = more ? resource.data.nextCursor : null;
    if (more && !cursor) return Promise.resolve([]);
    const key = summary ? "summary" : more ? `page:${cursor}` : "head";
    const promise = enqueue(key, expectedScope, async transportSignal => {
      if (more && resource.data.nextCursor !== cursor) throw aborted();
      const claim = coordinator.claim("activity", owner);
      const before = resource;
      if (!summary) publish(beginLoadState(resource, { scope, emptyData: resource.data }));
      try {
        const { loadNotificationPage } = await loadPageCommand();
        const assertCurrent = () => {
          requireScope(expectedScope);
          if (transportSignal.aborted || !coordinator.isCurrent(claim, owner)) throw aborted();
        };
        const rows = await loadNotificationPage({
          cursor, summary, more, demo, seed, fetchPage, makeError, getHiddenActorIds,
          signal: transportSignal, assertCurrent,
          getCurrent: () => ({ accountId: owner.accountId, revision: mutationRevision, data: resource.data, updatedAt: resource.updatedAt }),
          adopt: (next, unread) => {
            // Project and publish in one synchronous turn. An external confirmed
            // DM/privacy mutation cannot slip between them across an await.
            if (summary) publish(createLoadState({ ...resource, data: { ...resource.data, unread: unread + welcomeUnread(resource.data.rows), readContract: next.readContract } }));
            else publish(resolveLoadState({ scope, data: next, updatedAt: now() }));
          },
        });
        assertCurrent();
        return rows;
      } catch (error) {
        if (!valid(expectedScope) || transportSignal.aborted || isLoadCancellation(error)) {
          if (valid(expectedScope) && !summary && coordinator.isCurrent(claim, owner)) {
            publish(createLoadState({ ...before, data: resource.data }));
          }
          throw aborted();
        }
        const failure = normalizeError(error);
        if (!summary) publish(rejectLoadState(resource, { scope, error: failure, emptyData: resource.data }));
        throw failure;
      }
    });
    return observe(promise, signal);
  };
  const setRows = (update, expectedScope = sync()) => {
    if (!valid(expectedScope)) return;
    mutationRevision += 1;
    const before = resource.data.rows;
    const value = typeof update === "function" ? update(before) : update;
    const proposed = uniqueRows((Array.isArray(value) ? value : []).filter(row => row.userId === owner.accountId));
    const rows = proposed.slice(0, MAX_NOTIFICATION_ROWS);
    // Evicting cache rows is never evidence that those alerts were read.
    const difference = unreadRows(proposed) - unreadRows(before);
    publish(createLoadState({ ...resource, data: { ...resource.data, rows, unread: resource.data.unread == null ? null : Math.max(0, resource.data.unread + difference) } }));
  };
  const markRead = async ({ notificationIds, expectedScope = sync(), signal } = {}) => {
    if (!valid(expectedScope)) return commandFailure(makeError("Your account changed. Refresh Activity and try again.", "PIT-AUTH-004"));
    if (signal?.aborted) throw aborted();
    // Freeze the loaded set before queueing or downloading command code.
    const snapshot = resource.data;
    const requestedIds = Array.isArray(notificationIds) && notificationIds.length <= MAX_NOTIFICATION_ROWS ? [...notificationIds] : null;
    try {
      return await enqueue(`ack:${++writeSequence}`, expectedScope, async transportSignal => {
        // The whole runtime is lazy. Resolve the command inside the queue so
        // injected/deferred adapters cannot reorder reads and writes.
        const { markNotificationRows } = await loadReadCommand();
        return markNotificationRows({
          snapshot, notificationIds: requestedIds, signal, transportSignal, demo, writeReads, makeError,
          assertCurrent: () => requireScope(expectedScope),
          getCurrent: () => ({ accountId: owner.accountId, revision: mutationRevision, data: resource.data }),
          adopt: data => publish(createLoadState({ ...resource, data })),
        });
      });
    } catch (error) {
      if (isLoadCancellation(error, signal)) throw aborted();
      return commandFailure(normalizeError(error));
    }
  };
  return {
    getSnapshot: () => { sync(); return resource; },
    scope: sync,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    load, markRead, setRows,
    mount() { alive = true; sync(); },
    unmount() { alive = false; cancelOperations(); },
  };
}
