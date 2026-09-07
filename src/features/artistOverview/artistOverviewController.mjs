import { beginLoadState, createLoadState, isLoadCancellation, rejectLoadState, resolveLoadState } from "../../domain/loadState.mjs";
import { commandFailure, commandSuccess } from "../../domain/commandResult.mjs";
import { artistOverviewLocation } from "./artistOverviewRequest.mjs";

const aborted = () => Object.assign(new Error("Artist read cancelled."), { name: "AbortError" });
export function mergeArtistSchedule(items, incoming) {
  const rows = new Map(items.map((item) => [item.id, item]));
  for (const item of incoming) rows.set(item.id, item);
  return [...rows.values()];
}

// One mounted artist/account owns this entire controller. Nothing is persisted,
// shared across accounts, or inferred from the device's feed snapshot.
export function createArtistOverviewController({ artistKey, accountId = null, pageSize = 12, enabled = true, publicPreview = false, read, asError }) {
  let location = { countryCode: "", city: "" };
  const scopeFor = () => JSON.stringify([accountId || null, artistKey || null, publicPreview, location.countryCode, location.city]);
  let resource = createLoadState({ scope: scopeFor(), status: enabled && artistKey ? "loading" : "idle" });
  let active = null;
  let loadingMore = false;
  let moreError = null;
  let disposed = false;
  let snapshot;
  const listeners = new Set();
  const emit = () => {
    snapshot = { resource, loadingMore, moreError, ...location };
    for (const listener of listeners) listener();
  };
  const cancel = () => { active?.controller.abort(); active = null; };
  const current = (request) => !disposed && active === request && !request.controller.signal.aborted && request.scope === scopeFor();
  const run = async ({ more = false, signal } = {}) => {
    if (disposed || signal?.aborted) throw aborted();
    if (!enabled || !artistKey) return null;
    const before = resource;
    const after = more ? before.data?.schedule?.nextCursor : null;
    if (more && (!after || active || before.data?.schedule?.legacy)) return before.data;
    cancel();
    const request = { controller: new AbortController(), scope: scopeFor() };
    const relayAbort = () => request.controller.abort();
    signal?.addEventListener?.("abort", relayAbort, { once: true });
    active = request;
    loadingMore = more;
    moreError = null;
    if (!more) resource = beginLoadState(resource, { scope: request.scope, emptyData: resource.data });
    emit();
    try {
      const page = await read({ artistKey, accountId, publicPreview, limit: pageSize, after, ...location, signal: request.controller.signal });
      if (!current(request)) throw aborted();
      if (more && page.schedule.hasMore && page.schedule.nextCursor === after) throw asError(new TypeError("The show cursor did not advance."));
      const data = more && !page.schedule.legacy
        ? { ...page, schedule: { ...page.schedule, items: mergeArtistSchedule(before.data.schedule.items, page.schedule.items) } }
        : page;
      resource = resolveLoadState({ scope: request.scope, data });
      return data;
    } catch (error) {
      if (!current(request) || isLoadCancellation(error, request.controller.signal)) {
        // A caller-cancelled refresh restores the last settled snapshot, but
        // superseded work may never restore a previous location or account.
        if (active === request && !disposed && request.scope === scopeFor()) resource = before;
        throw aborted();
      }
      const failure = asError(error);
      if (more) { resource = before; moreError = failure; }
      else resource = rejectLoadState(resource, { scope: request.scope, error: failure, emptyData: resource.data });
      throw failure;
    } finally {
      signal?.removeEventListener?.("abort", relayAbort);
      if (active === request) { active = null; loadingMore = false; if (!disposed) emit(); }
    }
  };
  const handled = (operation) => operation.then(commandSuccess, (error) => isLoadCancellation(error) ? commandSuccess(null) : commandFailure(asError(error)));
  emit();
  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    resume() { disposed = false; },
    getSnapshot: () => snapshot,
    refresh: (options) => run(options),
    reload: () => handled(run()),
    loadMore: () => handled(run({ more: true })),
    setLocation(value) {
      const next = artistOverviewLocation(value);
      if (next.countryCode === location.countryCode && next.city === location.city) return Promise.resolve(commandSuccess(resource.data));
      cancel();
      const reputation = resource.data?.reputation || null;
      const artist = resource.data?.artist || null;
      const updatedAt = reputation ? resource.updatedAt : null;
      location = next;
      // Only the schedule is invalidated by location. The same viewer's
      // confirmed reputation retains its timestamp and never flashes to zero.
      resource = createLoadState({ scope: scopeFor(), status: "loading", updatedAt, data: reputation ? { artist, reputation, schedule: null } : null });
      loadingMore = false; moreError = null;
      emit();
      return handled(run());
    },
    dispose() { disposed = true; cancel(); listeners.clear(); },
  };
}
