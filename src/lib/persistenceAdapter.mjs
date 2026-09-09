/** Build the project's synchronous JSON persistence API over an injected store. */
export function createJsonPersistence(storage = null) {
  const memory = Object.create(null);
  const memoryOverrides = new Set();
  const removedOverrides = new Set();
  let errorHandler = null;
  let reportingError = false;

  const report = (error, operation, key) => {
    if (!errorHandler || reportingError) return;
    reportingError = true;
    try { errorHandler(error, { operation, key }); } catch {}
    reportingError = false;
  };

  return {
    load(key, fallback) {
      if (removedOverrides.has(key)) return fallback;
      if (memoryOverrides.has(key)) return JSON.parse(memory[key]);
      try {
        if (storage?.getItem) {
          const value = storage.getItem(key);
          return value == null ? fallback : JSON.parse(value);
        }
      } catch (error) { report(error, "read", key); }
      return Object.prototype.hasOwnProperty.call(memory, key) ? JSON.parse(memory[key]) : fallback;
    },

    save(key, value) {
      // Both backends have JSON snapshot semantics. A rejected serialization
      // must preserve the previous value (including a privacy-removal marker),
      // not retain a mutable object that durable storage could never represent.
      let serialized;
      try {
        serialized = JSON.stringify(value);
        if (typeof serialized !== "string") throw new TypeError("Persistence value must be JSON-serializable");
      } catch (error) { report(error, "write", key); return; }
      try {
        if (storage?.setItem) {
          storage.setItem(key, serialized);
          // Recovery makes durable storage authoritative again. Retire its old
          // failed-write fallback so later read trouble cannot resurrect it,
          // including after another tab has replaced or removed the value.
          delete memory[key];
          memoryOverrides.delete(key);
          removedOverrides.delete(key);
          return;
        }
      } catch (error) { report(error, "write", key); }
      memory[key] = serialized;
      memoryOverrides.add(key);
      removedOverrides.delete(key);
    },

    remove(key) {
      try {
        if (storage?.removeItem) {
          storage.removeItem(key);
          delete memory[key];
          memoryOverrides.delete(key);
          removedOverrides.delete(key);
          return;
        }
      } catch (error) { report(error, "remove", key); }
      // Mask an adapter value when deletion is unavailable or failed. Pit's web
      // and native adapters both implement physical deletion; this fallback
      // keeps the synchronous API privacy-safe for tests and unsupported hosts.
      delete memory[key];
      memoryOverrides.delete(key);
      removedOverrides.add(key);
    },

    setErrorHandler(handler) {
      errorHandler = typeof handler === "function" ? handler : null;
    },
  };
}
