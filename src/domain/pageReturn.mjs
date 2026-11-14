// A controller belongs to one app instance. Only the visible route may handle
// a title/tab gesture; retained screens and late unmounts cannot steal it.
export function createPageReturnController() {
  let activeScope = null;
  let beforeRequest = null;
  const handlers = new Map();
  const listeners = new Set();
  const changed = () => listeners.forEach((listener) => listener());
  return {
    activate(scope) { activeScope = scope; },
    setBeforeRequest(callback) { beforeRequest = callback; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    capability(scope) {
      const entries = [...handlers.values()].filter((candidate) => candidate.scope === scope);
      return entries.some((entry) => entry.refreshes) ? 2 : entries.length ? 1 : 0;
    },
    register(scope, handler, refreshes = true) {
      const token = {};
      handlers.set(token, { scope, handler, refreshes });
      changed();
      return () => { handlers.delete(token); changed(); };
    },
    request(scope) {
      if (scope !== activeScope) return false;
      const entries = [...handlers.values()].filter((candidate) => candidate.scope === scope);
      const entry = entries.find((candidate) => candidate.refreshes) || entries[0];
      if (!entry) return false;
      beforeRequest?.();
      entry.handler();
      return true;
    },
  };
}

export function scrollPageToTop(target) {
  if (typeof target?.scrollToOffset === "function") target.scrollToOffset({ offset: 0, animated: false });
  else if (typeof target?.scrollTo === "function") target.scrollTo({ x: 0, y: 0, animated: false });
}

export function assignScrollRef(ref, value) {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}
