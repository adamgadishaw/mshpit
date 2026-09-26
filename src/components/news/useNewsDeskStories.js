import { useCallback, useEffect, useRef, useState } from "react";
import { fetchNewsDeskStories } from "../../lib/newsDeskApi";

// Latest news desk stories with paging. `status` is idle | loading | ready | error.
// `artist` (a catalogue key) narrows them to stories about one artist.
export default function useNewsDeskStories({ enabled = true, limit = 20, artist = null } = {}) {
  const [state, setState] = useState({ stories: [], nextCursor: null, status: "idle" });
  const controllerRef = useRef(null);
  const cursorRef = useRef(null);

  const load = useCallback(async ({ more = false } = {}) => {
    if (more && !cursorRef.current) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState((current) => ({ ...current, status: "loading" }));
    try {
      const result = await fetchNewsDeskStories({ cursor: more ? cursorRef.current : null, limit, artist, signal: controller.signal });
      if (controller.signal.aborted) return;
      const incoming = Array.isArray(result?.stories) ? result.stories : [];
      cursorRef.current = result?.nextCursor || null;
      setState((current) => {
        const seen = new Set(more ? current.stories.map((story) => story.id) : []);
        const stories = more ? [...current.stories, ...incoming.filter((story) => !seen.has(story.id))] : incoming;
        return { stories, nextCursor: cursorRef.current, status: "ready" };
      });
    } catch {
      // architecture: allow-ambiguous-result -- news is optional; the views show an in-place error with a retry
      if (!controller.signal.aborted) setState((current) => ({ ...current, status: "error" }));
    }
  }, [artist, limit]);

  useEffect(() => {
    if (enabled) void load();
    return () => controllerRef.current?.abort();
  }, [enabled, load]);

  return { ...state, loadMore: () => load({ more: true }), reload: () => load() };
}
