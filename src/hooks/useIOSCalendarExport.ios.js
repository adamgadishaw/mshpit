import { useLayoutEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { exportCalendarEvents } from "../lib/calendarExport";

export default function useIOSCalendarExport(accountId, authEpoch) {
  const context = useRef(null);
  const request = useRef(null);
  const mounted = useRef(false);
  const [feedback, setFeedback] = useState(null);
  if (!context.current || context.current.accountId !== accountId || context.current.authEpoch !== authEpoch) {
    // A new identity, even for A -> B -> A, fences old handlers before effects.
    context.current = { accountId, authEpoch };
    request.current = null;
  }
  const identity = context.current;
  useLayoutEffect(() => {
    let live = true;
    mounted.current = true;
    setFeedback(null);
    const subscription = AppState.addEventListener("change", (state) => {
      if (!live) return;
      // Leaving the foreground revokes an intent that has not opened a sheet.
      // The sheet's own inactive transition must not revoke a presented share.
      if (state !== "active" && request.current && !request.current.presented) {
        request.current = null;
        setFeedback(null);
      }
    });
    return () => {
      live = false;
      mounted.current = false;
      request.current = null;
      subscription.remove();
    };
  }, []);

  const saveCalendar = async (events, key) => {
    if (!mounted.current || context.current !== identity || request.current || AppState.currentState !== "active") return;
    const claim = { identity };
    request.current = claim;
    const isCurrent = () => mounted.current && context.current === identity && request.current === claim;
    setFeedback({ identity, key, notice: null });
    try {
      const result = await exportCalendarEvents(events, {
        isCurrent: () => isCurrent() && AppState.currentState === "active",
        onPresenting: () => { claim.presented = true; },
      });
      if (!isCurrent()) return;
      if (result.status === "cancelled") {
        setFeedback(null);
        return;
      }
      setFeedback({ identity, key: "", notice: {
        ok: !result.cleanupFailed,
        text: result.cleanupFailed
          ? "The share sheet closed. The temporary calendar file could not be removed."
          : "Calendar sharing closed. Check your chosen app to confirm whether the file was saved or imported.",
      } });
    } catch (error) {
      if (isCurrent()) setFeedback({ identity, key: "", notice: {
        ok: false, text: error?.message || "The calendar file could not be prepared.",
      } });
    } finally {
      if (isCurrent()) request.current = null;
    }
  };

  return {
    saveCalendar,
    exportingKey: feedback?.identity === identity ? feedback.key : "",
    calendarNotice: feedback?.identity === identity ? feedback.notice : null,
  };
}
