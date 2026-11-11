// Navigation preferences only: no events, attendance rows, URLs, people or disk writes.
const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const offset = value => Number.isFinite(value) ? Math.max(0, Math.min(1000000, value)) : 0;
const dateKey = value => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  return y >= 1000 && m >= 1 && m <= 12 && d >= 1 && d <= new Date(y, m, 0).getDate() ? value : null;
};
const month = value => value && Number.isInteger(value.y) && value.y >= 1000 && value.y <= 9999
  && Number.isInteger(value.m) && value.m >= 0 && value.m < 12 ? { y: value.y, m: value.m } : null;

export function calendarBrowseSnapshot(value = {}, previous = null) {
  const selected = dateKey(value.selected) || previous?.selected || "1970-01-01";
  const [y, m] = selected.split("-").map(Number);
  const cursor = month(value.cursor) || previous?.cursor || { y, m: m - 1 };
  const choose = (key, allowed, fallback) => allowed.includes(value[key]) ? value[key] : previous?.[key] || fallback;
  const limit = Number.isSafeInteger(value.historyVisibleLimit) && value.historyVisibleLimit >= 30
    ? Math.min(100000, value.historyVisibleLimit) : previous?.historyVisibleLimit || 30;
  return Object.freeze({
    cursor: Object.freeze({ y: cursor.y, m: cursor.m }), selected,
    view: choose("view", ["upcoming", "past"], "upcoming"),
    scope: choose("scope", ["all", "local", "plans"], "all"),
    presentation: choose("presentation", ["month", "agenda"], "month"),
    historyVisibleLimit: limit,
    agendaLimit: Number.isSafeInteger(value.agendaLimit) && value.agendaLimit >= 40 && value.agendaLimit % 40 === 0
      ? value.agendaLimit : previous?.agendaLimit || 40,
    scrollY: own(value, "scrollY") ? offset(value.scrollY) : previous?.scrollY || 0,
  });
}

export function createCalendarBrowseMemory() {
  let accountId, authEpoch, generation = 0, entries = new WeakMap();
  return {
    account(id, epoch) {
      if (accountId === id && authEpoch === epoch) return;
      accountId = id; authEpoch = epoch; generation += 1;
      entries = new WeakMap();
    },
    claim(occurrence, identity, initialState) {
      if (!occurrence || typeof occurrence !== "object"
        || identity?.accountId !== accountId || identity?.authEpoch !== authEpoch) return null;
      let entry = entries.get(occurrence);
      const restored = !!entry;
      if (!entry) {
        entry = { snapshot: calendarBrowseSnapshot(initialState), claim: null };
        entries.set(occurrence, entry);
      }
      const token = generation, claim = {};
      entry.claim = claim;
      const current = () => token === generation && entry.claim === claim;
      return {
        restored, current,
        read: () => current() ? entry.snapshot : null,
        save(patch) {
          if (!current()) return null;
          entry.snapshot = calendarBrowseSnapshot(patch, entry.snapshot);
          return entry.snapshot;
        },
      };
    },
  };
}

// A single nonanimated restoration after real content is ready. Native layout
// and content events can arrive in either order; a new drag always wins.
export function createCalendarScrollReturn(initialY, save, isCurrent = () => true) {
  let pending = offset(initialY), height = 0, content = 0, ready = false, target = null;
  const restore = () => {
    if (!isCurrent() || pending == null || !ready || height <= 0 || content <= 0 || !target?.scrollTo) return;
    const y = Math.min(pending, Math.max(0, content - height));
    target.scrollTo({ y, animated: false });
    pending = null;
    save?.({ scrollY: y });
  };
  const onScroll = event => {
    if (!isCurrent() || pending != null) return;
    const y = event?.nativeEvent?.contentOffset?.y;
    if (Number.isFinite(y)) save?.({ scrollY: height > 0 && content > 0
      ? Math.min(offset(y), Math.max(0, content - height)) : offset(y) });
  };
  return {
    update(ref, isReady) { if (isCurrent()) { target = ref; ready = !!isReady; restore(); } },
    onLayout(event) {
      if (!isCurrent()) return;
      const next = event?.nativeEvent?.layout?.height;
      if (Number.isFinite(next)) height = Math.max(0, next);
      restore();
    },
    onContentSizeChange(_width, next) {
      if (!isCurrent()) return;
      if (Number.isFinite(next)) content = Math.max(0, next);
      restore();
    },
    onScroll,
    onScrollBeginDrag(event) {
      if (!isCurrent()) return;
      pending = null;
      onScroll(event);
    },
    cancel() { if (isCurrent()) pending = null; },
  };
}
