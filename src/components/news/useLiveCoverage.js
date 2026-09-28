import { useEffect, useState } from "react";
import { fetchLiveCoverage } from "../../lib/newsDeskApi";
import { anyLive, liveEventsFrom } from "../../domain/newsLive.mjs";

const REFRESH_MS = 60_000;

// Live coverage events; refreshed every minute while one is live. A failed
// read keeps what was shown before, so the card never flickers away.
export default function useLiveCoverage({ enabled = true } = {}) {
  const [events, setEvents] = useState([]);
  useEffect(() => {
    if (!enabled) return undefined;
    let controller = null;
    let timer = null;
    let stopped = false;
    const load = async () => {
      controller?.abort();
      controller = new AbortController();
      let next = null;
      try {
        next = liveEventsFrom(await fetchLiveCoverage({ signal: controller.signal }));
      } catch {
        // architecture: allow-ambiguous-result -- live coverage is optional; the card keeps its last good state
        next = null;
      }
      if (stopped) return;
      if (next) setEvents(next);
      if (next ? anyLive(next) : true) timer = setTimeout(load, REFRESH_MS);
    };
    void load();
    return () => {
      stopped = true;
      controller?.abort();
      if (timer) clearTimeout(timer);
    };
  }, [enabled]);
  return events;
}
