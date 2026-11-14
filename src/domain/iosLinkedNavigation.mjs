// One pending linked destination per iOS Root. Store still owns data/cache reads.
// Scopes fence callbacks retained by a departed route or authentication epoch.
export function createIOSLinkedNavigation() {
  let accountId, authEpoch, scope = {}, pending = null, mounted = false;
  const release = (claim) => {
    if (!claim || pending !== claim) return;
    pending = null;
    claim.controller.abort();
  };
  const invalidate = () => { release(pending); scope = {}; };
  const current = (claim) => mounted && !!claim && pending === claim
    && claim.scope === scope && !claim.controller.signal.aborted;
  return {
    account(id, epoch) {
      if (id !== accountId || epoch !== authEpoch) {
        accountId = id; authEpoch = epoch; invalidate();
      }
      return scope;
    },
    mount() { mounted = true; },
    unmount() {
      mounted = false;
      // StrictMode may set up this same owner again. Keep its render scope,
      // but never revive a lookup started before the effect cleanup.
      release(pending);
    },
    invalidate,
    ownsScope: (expectedScope) => mounted && expectedScope === scope,
    begin(expectedScope) {
      if (!mounted || expectedScope !== scope) return null;
      release(pending);
      const controller = new AbortController();
      pending = { scope, controller, signal: controller.signal };
      return pending;
    },
    current,
    release,
    consume(claim) {
      if (!current(claim)) return false;
      pending = null;
      return true;
    },
  };
}
