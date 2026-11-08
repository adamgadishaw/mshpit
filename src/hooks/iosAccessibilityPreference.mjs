// iOS gestures/animations stay conservative until the system preference is
// known. One subscription is shared by all hook consumers. A live event always
// outranks an older asynchronous initial read, even when its value is unchanged.
export function createIOSAccessibilityPreference({ read, listen, initial = true }) {
  let value = initial;
  let generation = 0;
  let revision = 0;
  let nativeSubscription = null;
  const listeners = new Set();
  const publish = (next) => {
    const normalized = !!next;
    if (normalized === value) return;
    value = normalized;
    for (const listener of listeners) listener();
  };
  const subscribe = (listener) => {
    listeners.add(listener);
    if (listeners.size === 1) {
      const currentGeneration = ++generation;
      const initialRevision = revision;
      nativeSubscription = listen((next) => {
        if (generation !== currentGeneration || !listeners.size) return;
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
      listeners.delete(listener);
      if (listeners.size) return;
      generation++;
      nativeSubscription?.remove?.();
      nativeSubscription = null;
      value = initial;
    };
  };
  return { subscribe, getSnapshot: () => value, getServerSnapshot: () => initial };
}
