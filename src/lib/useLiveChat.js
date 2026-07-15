import { useEffect, useRef } from "react";
import { AppState } from "react-native";

const DEFAULT_INTERVAL_MS = 3500;
const MAX_CATCH_UP_PAGES = 8;

// Poll one open conversation without overlapping requests. The server cursor
// advances forward, so each normal tick asks only for messages newer than the
// last successful response. A bounded catch-up loop drains bursts larger than a
// single page, and AppState cleanup prevents hidden/unmounted rooms from polling.
export default function useLiveChat(refresh, {
  channelKey,
  enabled = true,
  intervalMs = DEFAULT_INTERVAL_MS,
} = {}) {
  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);

  useEffect(() => {
    if (!enabled || !channelKey) return undefined;

    let active = AppState.currentState == null || AppState.currentState === "active";
    let stopped = false;
    let running = false;
    let timer = null;
    let controller = null;
    let syncCursor = null;

    const clearTimer = () => {
      if (timer != null) clearTimeout(timer);
      timer = null;
    };

    const schedule = (delay = intervalMs) => {
      clearTimer();
      if (!stopped && active) timer = setTimeout(run, delay);
    };

    const run = async () => {
      if (stopped || !active || running) return;
      running = true;
      controller = new AbortController();
      try {
        let page = 0;
        let hasMore = false;
        do {
          const result = await refreshRef.current({ after: syncCursor, signal: controller.signal });
          if (result?.syncCursor) syncCursor = result.syncCursor;
          hasMore = !!result?.hasMore;
          page += 1;
        } while (!stopped && active && hasMore && page < MAX_CATCH_UP_PAGES);
      } catch (error) {
        // The API client records non-abort failures in Diagnostics. Aborts are an
        // expected part of leaving a room or backgrounding the app.
        if (error?.name !== "AbortError" && !controller?.signal.aborted) {
          // Keep the loop alive; the next scheduled read is a clean retry.
        }
      } finally {
        running = false;
        controller = null;
        schedule();
      }
    };

    const subscription = AppState.addEventListener("change", (state) => {
      const nextActive = state === "active";
      if (nextActive === active) return;
      active = nextActive;
      clearTimer();
      if (!active) controller?.abort();
      else schedule(0);
    });

    schedule(0);
    return () => {
      stopped = true;
      clearTimer();
      controller?.abort();
      subscription.remove();
    };
  }, [channelKey, enabled, intervalMs]);
}
