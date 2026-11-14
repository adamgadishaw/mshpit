// Own only the pending JS announcement. Once handed to VoiceOver, React Native
// offers no API to retract queued speech. Keep the quiet window before handoff.
export function createIOSSearchAnnouncements({ announce, schedule = setTimeout, cancel = clearTimeout, delay = 450 }) {
  let intent = null;
  let pending = null;
  let generation = 0;
  const cancelPending = () => {
    generation += 1;
    if (pending !== null) cancel(pending);
    pending = null;
  };
  const reset = () => { cancelPending(); intent = null; };
  return {
    request(scope, query) {
      reset();
      const term = String(query || "").trim().toLowerCase();
      if (term) intent = { scope, query: term, delivered: false, key: null };
    },
    update({ scope, query, ready, outcome, message }) {
      if (!intent || intent.scope !== scope || intent.query !== query || intent.delivered) return;
      if (!ready || !message || !["results", "no-results", "error"].includes(outcome)) {
        cancelPending();
        intent.key = null;
        return;
      }
      const key = JSON.stringify([scope, query, outcome, message]);
      if (intent.key === key && pending !== null) return;
      cancelPending();
      intent.key = key;
      const currentIntent = intent;
      const token = generation;
      pending = schedule(() => {
        if (token !== generation || intent !== currentIntent || intent.delivered) return;
        pending = null;
        intent.delivered = true;
        announce(message, { queue: true });
      }, delay);
    },
    reset,
  };
}
