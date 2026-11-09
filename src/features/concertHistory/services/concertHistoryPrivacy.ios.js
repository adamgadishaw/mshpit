import { captureApiIdentityCheck } from "../../../lib/api";
import { invalidateIOSDetailPrivacy } from "../../../lib/iosDetailPrivacy";

// All retained occurrences share a data-free denial proof, not their rows or
// local map state. A denial retires every earlier success for this exact scope.
const scopes = new Map();
const abort = () => Object.assign(new Error("Concert history read expired."), { name: "AbortError" });
export function createConcertHistoryPrivacyScope({ accountId, authEpoch, targetId }) {
  const key = JSON.stringify([accountId, authEpoch, targetId]);
  let scope = scopes.get(key);
  if (!scope || !scope.identityCurrent()) {
    scope = { identityCurrent: captureApiIdentityCheck(accountId), revision: 0, denied: false, listeners: new Set() };
    scopes.set(key, scope);
    for (const [candidate, value] of scopes) {
      if (scopes.size <= 128) break;
      if (candidate !== key && !value.listeners.size) scopes.delete(candidate);
    }
  }
  const owned = () => scopes.get(key) === scope && scope.identityCurrent();
  const publish = () => { for (const listener of [...scope.listeners]) listener(); };
  return {
    subscribe(listener) { scope.listeners.add(listener); return () => scope.listeners.delete(listener); },
    getSnapshot: () => scope.revision,
    denied: () => scope.denied || !owned(),
    async read(request, { signal, recover = false } = {}) {
      const revision = scope.revision;
      const current = () => !signal?.aborted && owned() && scope.revision === revision;
      if (!current() || (scope.denied && !recover)) throw abort();
      try {
        const payload = await request();
        if (!current()) throw abort();
        if (recover && scope.denied) { scope.denied = false; scope.revision += 1; publish(); }
        const completionRevision = scope.revision;
        return { payload, revision: completionRevision,
          current: () => !signal?.aborted && owned() && scope.revision === completionRevision };
      } catch (error) {
        if (!current()) throw abort();
        if ([403, 404, 410].includes(Number(error?.status))) {
          scope.denied = true;
          scope.revision += 1;
          // Revoke queued Back/commands before notifying any React subscriber.
          invalidateIOSDetailPrivacy();
          publish();
        }
        throw error;
      }
    },
  };
}
