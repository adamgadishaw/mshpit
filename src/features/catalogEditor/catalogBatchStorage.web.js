// Unlike cache persistence, durable save keys must never silently fall back to memory.
export const catalogBatchStorage = {
  getItem: key => globalThis.localStorage.getItem(key),
  setItem: (key, value) => globalThis.localStorage.setItem(key, value),
};
