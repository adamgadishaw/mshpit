// iOS gestures/animations stay conservative until the system preference is
// known. One subscription is shared by all hook consumers. A live event always
// outranks an older asynchronous initial read, even when its value is unchanged.
export function createIOSAccessibilityPreference({ read, listen, initial = true }) {
  let value = initial;
  let confirmed = null;
  let generation = 0;
  let revision = 0;
  let nativeSubscription = null;
  const listeners = new Set();
  const confirmedListeners = new Set();
  const subscribed = () => listeners.size + confirmedListeners.size > 0;
  const publish = (next) => {
    const normalized = !!next;
    const changed = normalized !== value;
    const confirmedChanged = normalized !== confirmed;
    value = normalized;
    confirmed = normalized;
    // Speech observes every knowledge transition synchronously, even if React
    // batches a false -> true round trip. Existing boolean consumers keep their
    // conservative default and their original notification behavior.
    if (confirmedChanged) for (const listener of confirmedListeners) listener();
    if (changed) for (const listener of listeners) listener();
  };
  const subscribeTo = (collection, listener) => {
    const wasSubscribed = subscribed();
    collection.add(listener);
    if (!wasSubscribed) {
      const currentGeneration = ++generation;
      const initialRevision = revision;
      nativeSubscription = listen((next) => {
        if (generation !== currentGeneration || !subscribed()) return;
        revision++;
        publish(next);
      });
      Promise.resolve().then(read).then((next) => {
        if (generation === currentGeneration && revision === initialRevision) publish(next);
      }).catch(() => {
        // Keep the conservative current value. A rejected lookup must not
        // overwrite a newer live preference or disable an accessibility aid.
      });
    }
    return () => {
      collection.delete(listener);
      if (subscribed()) return;
      generation++;
      nativeSubscription?.remove?.();
      nativeSubscription = null;
      value = initial;
      confirmed = null;
    };
  };
  return {
    subscribe: listener => subscribeTo(listeners, listener),
    getSnapshot: () => value,
    getServerSnapshot: () => initial,
    subscribeConfirmed: listener => subscribeTo(confirmedListeners, listener),
    getConfirmedSnapshot: () => confirmed,
  };
}
