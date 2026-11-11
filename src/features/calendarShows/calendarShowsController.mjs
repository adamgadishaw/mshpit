import { CALENDAR_SHOW_PAGE_SIZE } from "./calendarShowsRequest.mjs";
import { beginLoadState, createLoadState, isLoadCancellation, rejectLoadState, resolveLoadState } from "../../domain/loadState.mjs";
import { commandFailure, commandSuccess } from "../../domain/commandResult.mjs";

const cancelled = () => Object.assign(new Error("Calendar read cancelled."), { name: "AbortError" });
const mergeRows = (current, incoming) => [...new Map([...current, ...incoming].map((event) => [event.id, event])).values()];

/** One account + month + location + selected window owns this ephemeral read. */
export function createCalendarShowsController({ query, read, asError, initialSummary = null, pageSize = CALENDAR_SHOW_PAGE_SIZE }) {
  if (typeof asError !== "function") throw new TypeError("Calendar reads require the application error adapter.");
  let active = null, paused = false, disposed = false, loadingMore = false;
  let consumedCursors = new Set();
  const empty = { events: [], nextCursor: null, complete: false,
    monthSummary: initialSummary || { dayPresence: {}, complete: false } };
  let resource = createLoadState({ scope: query.key, status: query.enabled ? "loading" : "idle", data: empty });
  let snapshot;
  const listeners = new Set();
  const emit = () => {
    const data = resource.data || empty;
    snapshot = {
      events: data.events, status: resource.status, error: resource.error, loadingMore,
      nextCursor: data.nextCursor, hasMore: data.nextCursor !== null, needsLocation: query.needsLocation,
      dayPresence: data.monthSummary.dayPresence, summaryComplete: data.monthSummary.complete,
      coverage: { from: query.from, through: query.through, complete: resource.status === "ready" && data.complete },
      queryKey: query.key, monthKey: query.monthKey, updatedAt: resource.updatedAt,
    };
    for (const listener of listeners) listener();
  };
  const current = (request) => !disposed && !paused && active === request && request.allowed() && !request.controller.signal.aborted;
  const stop = () => { active?.controller.abort(); active = null; };
  const run = async ({ more = false, signal, current: allowed = () => true } = {}) => {
    if (!query.enabled || disposed || paused || !allowed() || signal?.aborted) return null;
    if (more && (active || !snapshot.hasMore)) return null;
    const before = active?.before || resource;
    const after = more ? before.data.nextCursor : null;
    stop();
    const request = { controller: new AbortController(), allowed, before };
    active = request;
    const relay = () => request.controller.abort();
    signal?.addEventListener?.("abort", relay, { once: true });
    loadingMore = more;
    resource = beginLoadState(before, { scope: query.key, emptyData: before.data });
    emit();
    try {
      const page = await read(query, { after, limit: pageSize, signal: request.controller.signal });
      if (!current(request)) throw cancelled();
      if (more && page.nextCursor && (page.nextCursor === after || consumedCursors.has(page.nextCursor))) {
        throw new Error("Calendar pagination did not advance. Please retry.");
      }
      const events = more ? mergeRows(before.data.events, page.events) : mergeRows([], page.events);
      if (!more) consumedCursors = new Set();
      else consumedCursors.add(after);
      resource = resolveLoadState({ scope: query.key, data: { ...page, events } });
      return true;
    } catch (error) {
      if (!current(request) || isLoadCancellation(error, request.controller.signal)) {
        if (active === request && !disposed) resource = before;
        throw cancelled();
      }
      const failure = asError(error);
      resource = rejectLoadState(before, { scope: query.key, error: failure, emptyData: before.data });
      throw failure;
    } finally {
      signal?.removeEventListener?.("abort", relay);
      if (active === request) { active = null; loadingMore = false; if (!disposed) emit(); }
    }
  };
  const handled = operation => operation.then(commandSuccess,
    error => isLoadCancellation(error) ? commandSuccess(null) : commandFailure(asError(error)));
  emit();
  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot: () => snapshot,
    refresh: options => handled(run(options)),
    loadMore: options => handled(run({ ...options, more: true })),
    resume() { disposed = false; paused = false; },
    pause() {
      paused = true;
      const before = active?.before;
      stop();
      if (before) { resource = before; loadingMore = false; emit(); }
    },
    dispose() { disposed = true; stop(); listeners.clear(); },
  };
}
