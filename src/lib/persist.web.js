// Browser continuity uses localStorage. The HttpOnly cookie remains the
// authoritative credential; this cache must never contain secrets or tokens.
import { createJsonPersistence } from "./persistenceAdapter.mjs";

const localStorageAdapter = (() => {
  try {
    const storage = typeof window !== "undefined" ? window.localStorage : null;
    return storage ? {
      getItem: (key) => storage.getItem(key),
      setItem: (key, value) => storage.setItem(key, value),
    } : null;
  } catch {
    return null;
  }
})();

const persistence = createJsonPersistence(localStorageAdapter);

export const load = persistence.load;
export const save = persistence.save;
export const setPersistErrorHandler = persistence.setErrorHandler;
