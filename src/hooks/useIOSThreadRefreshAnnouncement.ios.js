import { useLayoutEffect, useRef } from "react";
import { AccessibilityInfo, AppState } from "react-native";
import { getConfirmedScreenReaderEnabled, subscribeConfirmedScreenReaderEnabled } from "./useScreenReaderEnabled";

// One accepted manual refresh owns one local claim. Revocation never cancels
// reads, changes their settlement, or replays speech when eligibility returns.
export default function useIOSThreadRefreshAnnouncement(accountId, authEpoch, recipient, owner, message) {
  const context = useRef(null);
  const lifetime = useRef(null);
  const pending = useRef(null);
  const revoke = () => {
    const claim = pending.current;
    pending.current = null;
    if (claim?.timer != null) clearTimeout(claim.timer);
    claim?.signal?.removeEventListener("abort", claim.abort);
  };
  if (!context.current || context.current.accountId !== accountId || context.current.authEpoch !== authEpoch
      || context.current.recipient !== recipient || context.current.owner !== owner) {
    revoke();
    context.current = { accountId, authEpoch, recipient, owner };
  }
  const identity = context.current;
  useLayoutEffect(() => {
    const life = {};
    lifetime.current = life;
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
  const eligible = () => lifetime.current && context.current === identity && !!accountId && !!recipient && owner?.alive
    && AppState.currentState === "active" && getConfirmedScreenReaderEnabled() === true;
  const current = claim => !!claim && pending.current === claim && claim.life === lifetime.current
    && !claim.signal?.aborted && eligible();
  return {
    begin(signal) {
      if (context.current !== identity) return null;
      revoke();
      if (!eligible() || signal?.aborted) return null;
      const claim = { life: lifetime.current, signal, timer: null, queued: false, abort: null };
      claim.abort = () => { if (pending.current === claim) revoke(); };
      pending.current = claim;
      signal?.addEventListener("abort", claim.abort, { once: true });
      return claim;
    },
    finish(claim, failed) {
      if (!current(claim)) {
        if (claim && pending.current === claim) revoke();
        return;
      }
      if (!failed) { revoke(); return; }
      if (claim.queued) return;
      claim.queued = true;
      claim.timer = setTimeout(() => {
        // Stale timers must not clear a newer accepted refresh's claim.
        if (!current(claim)) {
          if (pending.current === claim) revoke();
          return;
        }
        revoke(); // Consume before native handoff, including a native throw.
        // iOS cannot recall speech already handed to the VoiceOver queue.
        // architecture: allow-empty-catch -- Optional speech failure must not change refresh completion or expose transport text.
        try { AccessibilityInfo.announceForAccessibilityWithOptions(message, { queue: true }); } catch {}
      }, 120);
    },
  };
}
