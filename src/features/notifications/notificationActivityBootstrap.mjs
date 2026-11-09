import { beginLoadState, createLoadState, isLoadCancellation, rejectLoadState } from "../../domain/loadState.mjs";
import { commandFailure } from "../../domain/commandResult.mjs";

const key = ({ accountId, epoch, ready }) => JSON.stringify([accountId || null, epoch || 0, !!ready]);
const empty = () => ({ rows: [], unread: null, nextCursor: null, readContract: null, historyLimited: false });
const aborted = () => Object.assign(new Error("Activity request is no longer current."), { name: "AbortError" });

// Boot holds only a bounded account-owned memory snapshot while the runtime
// downloads. No updater closures or network commands are queued here. The
// runtime remains the sole owner of network ordering, deduplication and reads.
export function createNotificationActivityBootstrap(options) {
  const { getIdentity, normalizeError, loadRuntime = () => import("./notificationRuntime.mjs") } = options;
  let scope = key(getIdentity()), generation = 0, alive = true, runtime = null, pending = null;
  let resource = createLoadState({ scope, data: empty() });
  const listeners = new Set();
  const emit = () => { for (const listener of listeners) listener(); };
  const publish = next => { resource = next; emit(); };
  const sync = () => {
    const next = key(getIdentity());
    if (next !== scope) { scope = next; generation++; resource = createLoadState({ scope, data: empty() }); }
    runtime?.scope();
    return scope;
  };
  const valid = (expected, version = generation) => {
    sync(); const identity = getIdentity();
    return alive && version === generation && expected === scope && identity.accountId && identity.ready;
  };
  const initialize = () => {
    if (!pending) pending = loadRuntime().then(({ createNotificationRuntime }) => {
      sync();
      runtime = createNotificationRuntime(options);
      runtime.setRows(resource.data.rows, scope);
      if (!alive) runtime.unmount();
      runtime.subscribe(emit);
      emit();
      return runtime;
    }).catch(error => { pending = null; throw error; });
    return pending;
  };
  const load = (settings = {}) => {
    sync();
    if (runtime) return runtime.load(settings);
    const expected = settings.expectedScope ?? scope, version = generation;
    if (!valid(expected, version) || settings.signal?.aborted) return Promise.reject(aborted());
    if (!settings.summary) publish(beginLoadState(resource, { scope, emptyData: resource.data }));
    const operation = initialize().then(controller => {
      if (!valid(expected, version)) throw aborted();
      return controller.load({ ...settings, expectedScope: expected });
    }).catch(error => {
      if (!valid(expected, version) || isLoadCancellation(error, settings.signal)) throw aborted();
      const failure = normalizeError(error);
      if (!runtime && !settings.summary) publish(rejectLoadState(resource, { scope, error: failure, emptyData: resource.data }));
      throw failure;
    });
    // Cancelling one cold observer must not cancel another account-owned read.
    if (!settings.signal) return operation;
    return new Promise((resolve, reject) => {
      const cancel = () => reject(aborted());
      settings.signal.addEventListener("abort", cancel, { once: true });
      operation.then(resolve, reject).finally(() => settings.signal.removeEventListener("abort", cancel));
    });
  };
  return {
    scope: sync,
    getSnapshot: () => { sync(); return runtime ? runtime.getSnapshot() : resource; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    load,
    setRows(update, expected = sync()) {
      if (!valid(expected)) return;
      if (runtime) { runtime.setRows(update, expected); return; }
      const value = typeof update === "function" ? update(resource.data.rows) : update;
      const rows = (Array.isArray(value) ? value : []).filter(row => row.userId === getIdentity().accountId).slice(0, 1000);
      publish(createLoadState({ ...resource, data: { ...resource.data, rows } }));
    },
    markRead(settings) {
      sync();
      return runtime ? runtime.markRead(settings) : Promise.resolve(commandFailure(normalizeError(new Error("Activity is still loading. Try again."))));
    },
    mount() { alive = true; sync(); runtime?.mount(); },
    unmount() { alive = false; generation++; runtime?.unmount(); },
  };
}
