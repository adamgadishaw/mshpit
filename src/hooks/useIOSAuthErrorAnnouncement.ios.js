import { useLayoutEffect, useReducer, useRef } from "react";
import { AccessibilityInfo, AppState } from "react-native";
import { getConfirmedScreenReaderEnabled, subscribeConfirmedScreenReaderEnabled } from "./useScreenReaderEnabled";

// One accepted login/signup action owns one optional, non-sensitive notification.
// Revocation never touches authentication, credentials, or request settlement.
export default function useIOSAuthErrorAnnouncement(...scope) {
  const context = useRef(null);
  const lifetime = useRef(null);
  const [, reconnect] = useReducer(value => value + 1, 0);
  const pending = useRef(null);
  const revoke = () => {
    const claim = pending.current;
    pending.current = null;
    if (claim?.timer != null) clearTimeout(claim.timer);
    claim?.signal?.removeEventListener("abort", claim.abort);
  };
  if (!context.current || scope.some((value, index) => !Object.is(value, context.current.scope[index]))) {
    revoke();
    context.current = { scope };
  }
  const identity = context.current;
  useLayoutEffect(() => {
    const life = {};
    lifetime.current = life;
    // Reconnect publishes fresh controls. Captured handlers from a hidden or
    // StrictMode-cleaned presentation must not borrow this new lifetime.
    reconnect();
    const live = () => lifetime.current === life;
    const stopReader = subscribeConfirmedScreenReaderEnabled(() => {
      if (live() && getConfirmedScreenReaderEnabled() !== true) revoke();
    });
    const subscription = AppState.addEventListener("change", state => {
      if (live() && state !== "active") revoke();
    });
    return () => {
      if (live()) { lifetime.current = null; revoke(); }
      stopReader();
      subscription.remove();
    };
  }, []);
  const presentation = lifetime.current;
  const livePresentation = () => !!presentation && lifetime.current === presentation && context.current === identity;
  const eligible = () => livePresentation()
    && AppState.currentState === "active" && getConfirmedScreenReaderEnabled() === true;
  const current = claim => !!claim && pending.current === claim && claim.life === lifetime.current
    && !claim.signal?.aborted && eligible();
  return {
    begin(signal) {
      if (!livePresentation()) return null;
      revoke();
      if (!eligible() || signal?.aborted) return null;
      const claim = { life: lifetime.current, signal, timer: null, queued: false, abort: null };
      claim.abort = () => { if (pending.current === claim) revoke(); };
      pending.current = claim;
      signal?.addEventListener("abort", claim.abort, { once: true });
      return claim;
    },
    finish(claim, creating) {
      if (!current(claim)) {
        if (claim && pending.current === claim) revoke();
        return;
      }
      if (claim.queued) return;
      claim.queued = true;
      claim.timer = setTimeout(() => {
        // Stale timers must not clear a newer accepted action's claim.
        if (!current(claim)) {
          if (pending.current === claim) revoke();
          return;
        }
        revoke(); // Consume before native handoff, including a native throw.
        // iOS cannot recall speech already handed to the VoiceOver queue.
        // architecture: allow-empty-catch -- Optional speech failure must not change authentication settlement or expose credentials/transport text.
        try { AccessibilityInfo.announceForAccessibilityWithOptions(creating ? "Account creation could not be confirmed. Review the error before trying again." : "Sign-in could not be confirmed. Review the error before trying again.", { queue: true }); } catch {}
      }, 120);
    },
    cancel(claim) {
      if (livePresentation() && (claim === undefined || pending.current === claim)) revoke();
    },
  };
}
