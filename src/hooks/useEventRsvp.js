import { useEffect, useLayoutEffect, useState } from "react";
import { AppState } from "react-native";
import { eventRsvpWindow } from "../domain/eventRsvp.mjs";
import useIOSDetailPresentation from "./useIOSDetailPresentation";

// Refresh at the boundary and on app resume. Commands also check their own
// dispatch-time clock, so suspended timers cannot send an expired RSVP.
export default function useEventRsvp(event) {
  const presentation = useIOSDetailPresentation();
  const canAct = presentation.canAct || presentation.current;
  const [now, setNow] = useState(Date.now);
  const window = eventRsvpWindow(event, now);
  useLayoutEffect(() => {
    if (!presentation.active || !canAct() || window.closesAt == null || window.closesAt <= now) return undefined;
    const timer = setTimeout(() => { if (canAct()) setNow(Date.now()); }, Math.min(60_000, Math.max(1, window.closesAt - Date.now())));
    return () => clearTimeout(timer);
  }, [now, window.closesAt, presentation.active, canAct]);
  useLayoutEffect(() => { if (presentation.active && canAct()) setNow(Date.now()); }, [presentation.active, canAct]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", state => {
      if (state === "active" && canAct()) setNow(Date.now());
    });
    return () => subscription.remove();
  }, [canAct]);
  return window;
}
