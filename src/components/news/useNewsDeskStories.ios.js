import useIOSDetailPresentation from "../../hooks/useIOSDetailPresentation";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchNewsDeskStories } from "../../lib/newsDeskApi";
import { useNewsInteractions } from "./NewsInteractionContext";
import { emptyNewsState, newsPrivacyScope } from "../../domain/newsReaderState.mjs";

// Latest news desk stories with paging. The iOS variant retains admitted data:
// admitted rows survive inactivity, but requests and callbacks never do.
export default function useNewsDeskStories({ enabled = true, limit = 20, artist = null, sort = "latest", retainOnInactive = true } = {}) {
  const { active, current, guard, token } = useIOSDetailPresentation();
  const { session, blockedIds, removedIds, mutedIds, followedArtists, authReady } = useNewsInteractions();
  const scope = JSON.stringify([newsPrivacyScope({ session, blockedIds, removedIds, mutedIds, followedArtists }), artist, limit, sort]);
  const ready = !!enabled && !!authReady && active;
  const admission = useRef(null);
  if (admission.current?.scope !== scope || admission.current?.authReady !== authReady || admission.current?.retainOnInactive !== retainOnInactive) {
    admission.current = { scope, authReady, retainOnInactive, complete: false, cursor: null, cursors: new Set(), retry: null, status: "idle" };
  }
  const data = admission.current;
  const boundary = useRef(null);
  const controllerRef = useRef(null);
  const pendingRef = useRef(null);
  const mounted = useRef(true);
  const [state, setState] = useState(() => ({ ...emptyNewsState(scope), data }));
  if (boundary.current?.data !== data || boundary.current?.ready !== ready || boundary.current?.token !== token) {
    controllerRef.current?.abort();
    controllerRef.current = null;
    pendingRef.current = null;
    boundary.current = { data, ready, token };
  }
  const attempt = boundary.current;
  const load = useCallback(async ({ more = false } = {}) => {
    if (!current() || !mounted.current || boundary.current !== attempt || !attempt.ready || (more && !data.cursor)) return false;
    // A repeated append must not abort and redispatch the page already loading.
    if (more && pendingRef.current) return false;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const operation = { controller };
    const requestedCursor = more ? data.cursor : null;
    pendingRef.current = operation;
    const valid = () => current() && mounted.current && boundary.current === attempt && controllerRef.current === controller && !controller.signal.aborted;
    setState((current) => ({ ...(current.data === data ? current : emptyNewsState(scope)), data, status: "loading" }));
    try {
      const result = await fetchNewsDeskStories({ cursor: requestedCursor, limit, artist, sort, signal: controller.signal });
      if (!valid()) return false;
      if (!Array.isArray(result?.stories) || !Object.prototype.hasOwnProperty.call(result, "nextCursor")) throw new Error("Invalid news page");
      const incoming = result.stories;
      const nextCursor = result.nextCursor;
      if ((nextCursor != null && (typeof nextCursor !== "string" || !nextCursor))
        || (more && nextCursor && (nextCursor === requestedCursor || data.cursors.has(nextCursor)))) throw new Error("News cursor did not advance");
      if (!more) data.cursors.clear();
      else data.cursors.add(requestedCursor);
      data.cursor = nextCursor;
      data.complete = true;
      data.status = "ready";
      data.retry = null;
      setState((current) => {
        const previous = more && current.data === data ? current.stories : [];
        const byId = new Map(previous.map(story => [story.id, story]));
        for (const story of incoming) byId.set(story.id, story);
        const stories = [...byId.values()];
        return { data, scope, stories, nextCursor, status: "ready" };
      });
      return true;
    } catch {
      // architecture: allow-ambiguous-result -- news is optional; the views show an in-place error with a retry
      if (valid()) {
        data.complete = true;
        data.status = "error";
        data.retry = { more };
        setState((current) => ({ ...(current.data === data ? current : emptyNewsState(scope)), data, status: "error" }));
      }
      return false;
    } finally {
      if (pendingRef.current === operation) pendingRef.current = null;
    }
  }, [artist, limit, sort, attempt, data, scope]);

  useEffect(() => {
    mounted.current = true;
    if (!retainOnInactive) data.cursor = null;
    if (ready && (!retainOnInactive || !data.complete)) void load();
    return () => {
      mounted.current = false;
      if (boundary.current === attempt) {
        controllerRef.current?.abort();
        controllerRef.current = null;
        pendingRef.current = null;
      }
    };
  }, [ready, load, data, attempt, retainOnInactive]);

  const visible = authReady && (ready || retainOnInactive) && state.data === data;
  const view = visible ? state : emptyNewsState(scope, ready ? "loading" : "idle");
  const status = retainOnInactive && view.status === "loading" && !pendingRef.current ? data.status : view.status;
  return { scope, stories: view.stories, nextCursor: view.nextCursor, status, failedMore: status === "error" && data.retry?.more === true, loadMore: guard(() => load({ more: true })), reload: guard(() => load()), retry: guard(() => load({ more: data.retry?.more === true })) };
}
