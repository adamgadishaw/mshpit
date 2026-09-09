// Compare all copies instead of trusting the cookie unconditionally. Browsers
// can silently reject a cookie write while localStorage accepts the new intent.
const phases = new Set(["pending", "signed-out", "signed-in"]);

function normalized(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || typeof value.revision !== "string" || !value.revision.length
    || value.revision.length > 100 || !phases.has(value.phase)) return null;
  const order = value.order === undefined ? 0 : value.order;
  if (!Number.isSafeInteger(order) || order < 0) return null;
  return { revision: value.revision, phase: value.phase, order };
}

function safelyRead(read) {
  try { return normalized(read()); }
  catch { return null; }
}

export function createAuthIntentPersistence({
  readStored = () => null, writeStored = () => {},
  readCookie = () => null, writeCookie = () => {}, now = Date.now,
} = {}) {
  let memory = null;
  const read = () => {
    // A tie normally favors durable state and then the cookie. Conflicting
    // revisions at the same clock value fail closed: an older signed-in cookie
    // must not erase a concurrent (or saturated-clock) sign-out/pending intent.
    const copies = [memory, safelyRead(readStored), safelyRead(readCookie)];
    let latest = null;
    for (const copy of copies) {
      if (!copy || (latest && copy.order < latest.order)) continue;
      if (latest && copy.order === latest.order && copy.revision !== latest.revision
        && latest.phase !== "signed-in" && copy.phase === "signed-in") continue;
      latest = copy;
    }
    if (latest) memory = latest;
    return latest ? { ...latest } : null;
  };
  const write = (value) => {
    const intent = normalized({ revision: value?.revision, phase: value?.phase });
    if (!intent) throw new TypeError("Invalid authentication intent.");
    const highest = read()?.order || 0;
    const clock = Number(now());
    const wallTime = Number.isSafeInteger(clock) && clock >= 0 ? clock : 0;
    // Corrupt but integer-shaped storage must never make logout throw before
    // it clears private state. At the ceiling, revision + fail-closed ties keep
    // the new blocking intent ahead of stale signed-in durable copies.
    const order = Math.max(wallTime, highest < Number.MAX_SAFE_INTEGER ? highest + 1 : highest);
    const next = { ...intent, order };
    memory = next;
    try { writeStored({ ...next }); }
    catch {
      // architecture: allow-empty-catch -- cookie and memory independently retain the new intent after storage failure.
    }
    try { writeCookie({ ...next }); }
    catch {
      // architecture: allow-empty-catch -- storage and memory independently retain intent after cookie failure.
    }
    return { ...next };
  };
  return { read, write };
}
