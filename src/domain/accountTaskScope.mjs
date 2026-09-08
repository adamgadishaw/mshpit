// A device picker and its later upload are one account-owned operation. An
// account round trip or unmount invalidates the whole operation, not just the
// HTTP request that happens to be running at the time.
export function createAccountTaskScope() {
  let accountId = null;
  let epoch = 0;
  let mounted = false;
  const controllers = new Set();
  const invalidate = () => {
    epoch += 1;
    for (const controller of controllers) controller.abort();
    controllers.clear();
  };
  return {
    setAccount(next) {
      const normalized = typeof next === "string" && next.trim() ? next.trim() : null;
      if (normalized !== accountId) { accountId = normalized; invalidate(); }
    },
    mount() { mounted = true; },
    dispose() { mounted = false; invalidate(); },
    begin(expectedAccountId, controller = new AbortController()) {
      if (!mounted || !accountId || expectedAccountId !== accountId) return null;
      const owner = accountId;
      const generation = epoch;
      controllers.add(controller);
      return {
        accountId: owner,
        controller,
        ownsScope: () => mounted && accountId === owner && epoch === generation,
        isCurrent: () => mounted && accountId === owner && epoch === generation && !controller.signal.aborted,
        finish: () => controllers.delete(controller),
      };
    },
  };
}
