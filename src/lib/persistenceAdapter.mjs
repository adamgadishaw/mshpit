/** Build the project's synchronous JSON persistence API over an injected store. */
export function createJsonPersistence(storage = null) {
  const memory = Object.create(null);
  const memoryOverrides = new Set();
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
      if (memoryOverrides.has(key)) return memory[key];
      try {
        if (storage?.getItem) {
          const value = storage.getItem(key);
          return value == null ? fallback : JSON.parse(value);
        }
      } catch (error) { report(error, "read", key); }
      return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : fallback;
    },

    save(key, value) {
      try {
        if (storage?.setItem) {
          storage.setItem(key, JSON.stringify(value));
          memoryOverrides.delete(key);
          return;
        }
      } catch (error) { report(error, "write", key); }
      memory[key] = value;
      memoryOverrides.add(key);
    },

    setErrorHandler(handler) {
      errorHandler = typeof handler === "function" ? handler : null;
    },
  };
}
