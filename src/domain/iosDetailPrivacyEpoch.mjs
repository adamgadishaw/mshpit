// An opaque, process-local fence for retained iOS detail occurrences. No route,
// account, profile, or media payload is retained or sent to subscribers here.
export function createIOSDetailPrivacyEpoch() {
  let revision = 0;
  const listeners = new Set();
  return {
    getSnapshot: () => revision,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    invalidate() {
      revision += 1;
      // Publish synchronously: a queued gesture must reject its old occurrence
      // before React commits the Store's accompanying state updates.
      for (const listener of [...listeners]) listener();
      return revision;
    },
  };
}
