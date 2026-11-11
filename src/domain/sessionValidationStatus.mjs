// Presentation only: the Store identity effect owns every request and retry.
// Each effect setup leases the channel, so StrictMode cleanup and late callbacks
// from an older owner cannot publish into the current session check.
export function createSessionValidationStatus() {
  let owner = null;
  let snapshot = Object.freeze({ phase: "checking", retry: null });
  const listeners = new Set();
  const publish = (next) => {
    snapshot = Object.freeze(next);
    for (const listener of listeners) listener();
  };
  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    begin() {
      const token = {};
      owner = token;
      const update = (phase, retry) => {
        if (owner !== token) return;
        const next = { phase, retry: null };
        if (retry) next.retry = () => {
          if (owner !== token || snapshot !== next) return;
          return retry();
        };
        publish(next);
      };
      update("checking");
      return Object.freeze({
        checking: () => update("checking"),
        unavailable: (retry) => update("unavailable", retry),
        waiting: () => update("waiting"),
        clear: () => update("idle"),
        dispose() { if (owner === token) { owner = null; publish({ phase: "checking", retry: null }); } },
      });
    },
  });
}
