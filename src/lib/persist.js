// Lightweight persistence so the session and key state survive a page refresh /
// navigation. Uses localStorage on web; guarded so it's a harmless no-op on native
// (the real build swaps in AsyncStorage + a server session token).
//
// Prototype note: we persist the session + users here for continuity. A real
// backend would store a signed token, never credentials, in the client.
const mem = {};
const LS = (() => {
  try { return typeof window !== "undefined" && window.localStorage ? window.localStorage : null; } catch { return null; }
})();

export function load(key, fallback) {
  try {
    if (LS) {
      const v = LS.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    }
  } catch {}
  return key in mem ? mem[key] : fallback;
}

export function save(key, val) {
  try {
    if (LS) { LS.setItem(key, JSON.stringify(val)); return; }
  } catch {}
  mem[key] = val;
}
