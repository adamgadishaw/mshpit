// Ephemeral UI preferences only. Never retain result rows, identities, or disk state.
const text = (value) => typeof value === "string" ? value.slice(0, 240) : "";
const offset = (value) => Number.isFinite(value) ? Math.max(0, Math.min(100000, value)) : 0;
export function browseSnapshot(tab, value = {}) {
  const common = { query: text(value.query), scrollY: offset(value.scrollY) };
  if (tab === "search") return { ...common, category: text(value.category) || "all" };
  return { ...common, programme: text(value.programme), genre: text(value.genre),
    region: text(value.region), scope: value.scope === "local" ? "local" : "country", touched: value.touched === true,
    days: [30, 60, 90].includes(value.days) ? value.days : 30,
    eventView: value.eventView === "list" ? "list" : "cards", eventWeek: text(value.eventWeek), genreFocused: value.genreFocused === true };
}
export function createBrowseReturnStore() {
  let account, generation = 0;
  const entries = new Map(), leases = new Map();
  return {
    account(id) {
      if (account === id) return;
      account = id; generation += 1; entries.clear(); leases.clear();
    },
    reset(tab) { entries.delete(tab); leases.delete(tab); generation += 1; },
    lease(tab) {
      if (!['search', 'discover'].includes(tab)) return null;
      if (leases.has(tab)) return leases.get(tab);
      const owner = account, token = generation;
      const lease = { key: `${tab}:${token}`, read: () => account === owner && leases.get(tab) === lease ? entries.get(tab) : undefined,
        save(patch) {
          if (account !== owner || leases.get(tab) !== lease) return;
          entries.set(tab, browseSnapshot(tab, { ...entries.get(tab), ...patch }));
        } };
      leases.set(tab, lease); return lease;
    },
  };
}
// Restore only after data and layout are ready; content/layout events can arrive in either order.
// A user's new gesture cancels pending restoration instead of fighting their scroll.
export function createBrowseScrollReturn(initialY, save) {
  let pending = offset(initialY), height = 0, content = 0, ready = false, target = null;
  const restore = () => {
    if (pending == null || !ready || height <= 0 || content <= 0 || !target?.scrollTo) return;
    // Loading placeholders must not consume a saved offset. If refreshed content
    // is shorter, leave the user at the top rather than jump to an unrelated row.
    if (content - height < pending) return;
    const y = pending;
    pending = null; target.scrollTo({ y, animated: false }); save?.({ scrollY: y });
  };
  return {
    update(ref, isReady) { target = ref; ready = isReady; restore(); },
    onLayout(event) { height = event.nativeEvent.layout.height; restore(); },
    onContentSizeChange(_width, nextHeight) { content = nextHeight; restore(); },
    onScroll(event) { if (pending == null) save?.({ scrollY: offset(event.nativeEvent.contentOffset.y) }); },
    onScrollBeginDrag() { pending = null; },
    cancel() { pending = null; save?.({ scrollY: 0 }); },
  };
}
