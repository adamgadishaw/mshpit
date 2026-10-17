import { useCallback, useEffect, useRef, useState } from "react";
import { fetchNewsDeskStories } from "../../lib/newsDeskApi";
import { useNewsInteractions } from "./NewsInteractionContext";
import { emptyNewsState, newsPrivacyScope, newsStateForScope } from "../../domain/newsReaderState.mjs";

// Latest news desk stories with paging. `status` is idle | loading | ready | error.
// `artist` (a catalogue key) narrows them to stories about one artist;
// `sort: "top"` ranks the last three days by score and engagement.
export default function useNewsDeskStories({ enabled = true, limit = 20, artist = null, sort = "latest" } = {}) {
  const { session, blockedIds, removedIds, mutedIds, followedArtists, authReady } = useNewsInteractions();
  const scope = JSON.stringify([newsPrivacyScope({ session, blockedIds, removedIds, mutedIds, followedArtists }), artist, limit, sort]);
  const ready = enabled && authReady;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const [state, setState] = useState(() => emptyNewsState(scope));
  const controllerRef = useRef(null);
  const cursorRef = useRef(null);
  const pendingRef = useRef(null);
  const retryRef = useRef(null);

  const load = useCallback(async ({ more = false } = {}) => {
    if (!ready || (more && (!cursorRef.current?.cursor || cursorRef.current.scope !== scope))) return false;
    // A repeated append must not abort and redispatch the page already loading.
    if (more && pendingRef.current?.scope === scope) return false;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const operation = { scope, more, controller };
    pendingRef.current = operation;
    retryRef.current = null;
    setState((current) => ({ ...newsStateForScope(current, scope), status: "loading" }));
    try {
      const result = await fetchNewsDeskStories({ cursor: more ? cursorRef.current.cursor : null, limit, artist, sort, signal: controller.signal });
      if (controller.signal.aborted || scopeRef.current !== scope || controllerRef.current !== controller) return false;
      const incoming = Array.isArray(result?.stories) ? result.stories : [];
      cursorRef.current = { scope, cursor: result?.nextCursor || null };
      setState((current) => {
        const seen = new Set(more ? current.stories.map((story) => story.id) : []);
        const stories = more ? [...current.stories, ...incoming.filter((story) => !seen.has(story.id))] : incoming;
        return { scope, stories, nextCursor: cursorRef.current.cursor, status: "ready" };
      });
      return true;
    } catch {
      // architecture: allow-ambiguous-result -- news is optional; the views show an in-place error with a retry
      if (!controller.signal.aborted && scopeRef.current === scope && controllerRef.current === controller) {
        retryRef.current = { scope, more };
        setState((current) => ({ ...newsStateForScope(current, scope), status: "error" }));
      }
      return false;
    } finally {
      if (pendingRef.current === operation) pendingRef.current = null;
    }
  }, [artist, limit, sort, ready, scope]);

  useEffect(() => {
    cursorRef.current = null;
    if (ready) void load();
    return () => controllerRef.current?.abort();
  }, [ready, load]);

  return { ...newsStateForScope(state, scope, ready), failedMore: state.status === "error" && retryRef.current?.scope === scope && retryRef.current.more === true, loadMore: () => load({ more: true }), reload: () => load(), retry: () => load({ more: retryRef.current?.scope === scope && retryRef.current.more === true }) };
}
