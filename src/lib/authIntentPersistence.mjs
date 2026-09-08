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
    // A tie favors durable state over this tab's cached copy, and the shared
    // cookie over storage. Phase updates may share an auth revision across tabs.
    const copies = [memory, safelyRead(readStored), safelyRead(readCookie)];
    let latest = null;
    for (const copy of copies) {
      if (copy && (!latest || copy.order >= latest.order)) latest = copy;
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
    const order = Math.max(wallTime, highest + 1);
    if (!Number.isSafeInteger(order)) throw new RangeError("Authentication intent order is exhausted.");
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
