import { concertHistoryResponse, withoutConcertLocation } from "./concertHistoryRequest.mjs";

export const CONCERT_HISTORY_BATCH_PAGES = 5;
const empty = () => ({ concerts: [], nextCursor: null, complete: false, mapVisible: true, status: "loading", loadingMore: false, error: "", openingId: null, openingError: "" });
const denied = (error) => [401, 403, 404, 409].includes(error?.status);

// A resource belongs to exactly one viewer/session generation/profile. There is
// no shared cache: switching identity cannot reuse another viewer's history.
export function createConcertHistoryResource({ requestPage, readPost, batchPages = CONCERT_HISTORY_BATCH_PAGES }) {
  let state = empty(), controller = null, opening = null, flight = null, disposed = false;
  const listeners = new Set();
  const removedPosts = new Set();
  const publish = (patch) => {
    if (disposed) return;
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const load = (reset = false) => {
    if (disposed) return Promise.resolve();
    if (reset && flight) { controller?.abort(); flight = null; }
    if (flight || !reset && state.complete) return flight || Promise.resolve();
    const active = new AbortController();
    controller = active;
    const signal = active.signal;
    let cursor = reset ? null : state.nextCursor;
    let concerts = reset ? [] : state.concerts;
    let mapVisible = reset ? true : state.mapVisible;
    const seen = new Set(cursor ? [cursor] : []);
    publish({ status: state.concerts.length ? "ready" : "loading", loadingMore: !!state.concerts.length, error: "" });
    flight = (async () => {
      try {
        for (let page = 0; page < batchPages; page += 1) {
          const payload = await requestPage({ before: cursor, signal });
          if (disposed || signal.aborted) return;
          const result = concertHistoryResponse(payload);
          if (result.nextCursor && seen.has(result.nextCursor)) throw new TypeError("History pagination did not advance.");
          if (result.nextCursor) seen.add(result.nextCursor);
          // Once disabled, no later page in this batch can republish old pins.
          mapVisible = mapVisible && result.mapVisible;
          const byId = new Map(concerts.map((row) => [row.id, row]));
          for (const row of result.concerts) byId.set(row.id, row);
          concerts = [...byId.values()].filter((row) => !removedPosts.has(row.postId))
            .map((row) => mapVisible ? row : withoutConcertLocation(row));
          cursor = result.nextCursor;
          publish({ concerts, nextCursor: cursor, complete: result.complete, mapVisible, status: "ready" });
          if (result.complete) break;
        }
      } catch (error) {
        if (disposed || signal.aborted) return;
        publish({
          ...(denied(error) ? { concerts: [], nextCursor: null, complete: false, mapVisible: false } : {}),
          status: "error",
          error: denied(error) ? "This concert history is no longer available." : "Concert history could not be loaded. Please try again.",
        });
      } finally {
        if (!disposed && !signal.aborted) publish({ loadingMore: false });
        if (controller === active) flight = null;
      }
    })();
    return flight;
  };
  return {
    getSnapshot: () => state,
    activate: () => { disposed = false; },
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    loadMore: () => load(false),
    retry: () => load(!state.nextCursor),
    refresh: () => load(true),
    removePost: (postId) => {
      removedPosts.add(postId);
      publish({ concerts: state.concerts.filter((row) => row.postId !== postId) });
    },
    async openConcert(row, onOpen) {
      if (disposed || !row?.postId || removedPosts.has(row.postId) || opening) return;
      const active = new AbortController();
      opening = active;
      publish({ openingId: row.id, openingError: "" });
      try {
        const post = await readPost(row.postId, { signal: active.signal });
        if (disposed || active.signal.aborted || removedPosts.has(row.postId)) return;
        if (!post || post.id !== row.postId) throw new TypeError("The review is no longer available.");
        onOpen?.(post);
      } catch (error) {
        if (!disposed && !active.signal.aborted) {
          if (denied(error)) {
            removedPosts.add(row.postId);
            publish({ concerts: state.concerts.filter((item) => item.postId !== row.postId) });
          }
          publish({ openingError: "That review could not be opened. Please try again." });
        }
      } finally {
        if (!disposed && !active.signal.aborted) publish({ openingId: null });
        if (opening === active) opening = null;
      }
    },
    dispose() { disposed = true; controller?.abort(); opening?.abort(); opening = null; flight = null; listeners.clear(); },
  };
}
