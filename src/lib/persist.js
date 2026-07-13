// Lightweight persistence so the session and key state survive a page refresh /
// navigation. Uses localStorage on web; guarded so it's a harmless no-op on native
// (the real build swaps in AsyncStorage + a server session token).
//
// The browser may cache public session/user projections for continuity; the
// authoritative credential remains the server's HttpOnly session cookie. Never
// put passwords, reset tokens, provider secrets, or raw API bodies through here.
const mem = {};
let errorHandler = null;
let reportingError = false;
const LS = (() => {
  try { return typeof window !== "undefined" && window.localStorage ? window.localStorage : null; } catch { return null; }
})();

export function load(key, fallback) {
  try {
    if (LS) {
      const v = LS.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    }
  } catch (error) { reportPersistError(error, "read", key); }
  return key in mem ? mem[key] : fallback;
}

export function save(key, val) {
  try {
    if (LS) { LS.setItem(key, JSON.stringify(val)); return; }
  } catch (error) { reportPersistError(error, "write", key); }
  mem[key] = val;
}

function reportPersistError(error, operation, key) {
  if (!errorHandler || reportingError) return;
  reportingError = true;
  try { errorHandler(error, { operation, key }); } catch {}
  reportingError = false;
}

// Diagnostics registers this after it initializes. Keeping the callback here
// avoids a persistence -> diagnostics -> persistence import cycle.
export function setPersistErrorHandler(handler) {
  errorHandler = typeof handler === "function" ? handler : null;
}
