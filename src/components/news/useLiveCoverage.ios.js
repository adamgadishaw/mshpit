import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { fetchLiveCoverage } from "../../lib/newsDeskApi";
import { anyLive, liveEventsFrom } from "../../domain/newsLive.mjs";

// Keep admitted public coverage on screen, but retire the polling owner during
// render so a queued timer cannot start a request before effect cleanup runs.
export default function useLiveCoverage({ enabled = true, isCurrent = null } = {}) {
  const [events, setEvents] = useState([]);
  const owner = useMemo(() => ({ enabled, lifetime: null }), [enabled, isCurrent]);
  const live = useRef(null);
  if (live.current !== owner) {
    const previous = live.current?.lifetime;
    if (previous) {
      previous.active = false;
      previous.controller?.abort();
      clearTimeout(previous.timer);
    }
    live.current = owner;
  }
  useLayoutEffect(() => {
    const lifetime = { active: true, controller: null, timer: null };
    owner.lifetime = lifetime;
    const current = () => live.current === owner && owner.enabled
      && owner.lifetime === lifetime && lifetime.active && (!isCurrent || isCurrent());
    const load = async () => {
      if (!current()) return;
      lifetime.controller?.abort();
      const controller = new AbortController();
      lifetime.controller = controller;
      let next = null;
      try {
        next = liveEventsFrom(await fetchLiveCoverage({ signal: controller.signal }));
      } catch {
        // architecture: allow-ambiguous-result -- optional public coverage keeps its last admitted events and retries while visible
        next = null;
      }
      if (!current() || controller.signal.aborted || lifetime.controller !== controller) return;
      if (next) setEvents(next);
      if (next ? anyLive(next) : true) lifetime.timer = setTimeout(load, 60_000);
    };
    if (enabled) void load();
    return () => {
      lifetime.active = false;
      lifetime.controller?.abort();
      clearTimeout(lifetime.timer);
    };
  }, [owner, enabled, isCurrent]);
  return events;
}
