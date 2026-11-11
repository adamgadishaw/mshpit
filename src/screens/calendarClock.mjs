// One clock per screen admission. Server acceptance never restarts the owner.
export function createCalendarClock({ readTime, onChange, isCurrent, isActive,
  now = Date.now, schedule = setTimeout, cancel = clearTimeout }) {
  let retired = false, request = 0, timer = null, offset = 0;
  const current = () => !retired && isCurrent() && isActive();
  const clear = () => { if (timer !== null) cancel(timer); timer = null; };
  const publish = () => {
    if (!current()) return;
    clear();
    const date = new Date(now() + offset);
    onChange(date);
    const midnight = new Date(date); midnight.setHours(24, 0, 0, 25);
    timer = schedule(() => { timer = null; void refresh(); }, Math.max(1000, midnight.getTime() - date.getTime()));
  };
  const refresh = async () => {
    if (!current()) return false;
    const token = ++request;
    // Keep advancing the last accepted server clock during offline periods.
    publish();
    try {
      const result = await readTime();
      if (!current() || token !== request) return false;
      const timestamp = result?.now ? new Date(result.now).getTime() : NaN;
      if (!Number.isFinite(timestamp)) return false;
      offset = timestamp - now();
      publish();
      return true;
    } catch {
      // architecture: allow-ambiguous-result -- Optional clock sync failure retains the advancing accepted clock or device fallback.
      return false;
    }
  };
  return {
    refresh,
    pause() { request++; clear(); },
    retire() { retired = true; request++; clear(); },
  };
}
