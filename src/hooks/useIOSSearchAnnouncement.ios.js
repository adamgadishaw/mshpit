import { useLayoutEffect, useReducer, useRef } from "react";
import { AccessibilityInfo, AppState } from "react-native";
import { createIOSSearchAnnouncements } from "../domain/iosSearchAnnouncements.mjs";
import { getConfirmedScreenReaderEnabled, subscribeConfirmedScreenReaderEnabled } from "./useScreenReaderEnabled";

// Only an explicit query edit or Retry may own speech. Eligibility returning
// never recreates that intent, and cancellation never touches search requests.
export default function useIOSSearchAnnouncement(scope, authEpoch) {
  const context = useRef(null);
  const lifetime = useRef(null);
  const [, reconnect] = useReducer(value => value + 1, 0);
  if (!context.current || context.current.scope !== scope || context.current.authEpoch !== authEpoch) {
    context.current?.announcements.reset();
    const identity = { scope, authEpoch };
    identity.announcements = createIOSSearchAnnouncements({
      announce(message, options) {
        if (context.current !== identity || !lifetime.current
            || AppState.currentState !== "active" || getConfirmedScreenReaderEnabled() !== true) return;
        // iOS cannot recall speech already handed to the VoiceOver queue.
        // architecture: allow-empty-catch -- Optional speech must not affect search settlement.
        try { AccessibilityInfo.announceForAccessibilityWithOptions(message, options); } catch {}
      },
    });
    context.current = identity;
  }
  const identity = context.current;
  useLayoutEffect(() => {
    const life = {};
    lifetime.current = life;
    // Reconnected presentations publish fresh controls; old handlers cannot
    // borrow a StrictMode/Suspense replacement lifetime or revoke its intent.
    reconnect();
    const live = () => lifetime.current === life;
    const stopReader = subscribeConfirmedScreenReaderEnabled(() => {
      if (live() && getConfirmedScreenReaderEnabled() !== true) context.current.announcements.reset();
    });
    const subscription = AppState.addEventListener("change", state => {
      if (live() && state !== "active") context.current.announcements.reset();
    });
    return () => {
      if (live()) { lifetime.current = null; context.current.announcements.reset(); }
      stopReader();
      subscription.remove();
    };
  }, []);
  const presentation = lifetime.current;
  const live = () => !!presentation && lifetime.current === presentation && context.current === identity;
  const eligible = () => live() && AppState.currentState === "active" && getConfirmedScreenReaderEnabled() === true;
  return {
    isCurrent: live,
    request(requestScope, query) {
      if (!live()) return;
      identity.announcements.reset();
      if (eligible() && requestScope === scope) identity.announcements.request(scope, query);
    },
    update(result) {
      if (!live()) return;
      if (!eligible()) { identity.announcements.reset(); return; }
      identity.announcements.update(result);
    },
  };
}
