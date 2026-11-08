import { useLayoutEffect, useRef } from "react";
import { AccessibilityInfo, AppState } from "react-native";
import { getConfirmedScreenReaderEnabled, subscribeConfirmedScreenReaderEnabled } from "./useScreenReaderEnabled";

const messages = Object.freeze({
  confirmed: "Comment confirmed.",
  unconfirmed: "Your comment could not be confirmed. Retry the previous comment or discard its unconfirmed attempt. Any newer draft will stay here.",
  parentUnavailable: "This reply target is unavailable in this thread. Clear it or choose another comment before sending.",
  retryParentUnavailable: "The previous reply target is unavailable in this thread. Refresh the thread to retry, or discard the unconfirmed attempt. Its original delivery details are still saved.",
});

// Only explicit, accepted composer actions may arm this local announcement.
// Revocation never touches delivery or the Root-owned draft/attempt.
export default function useIOSCommentAnnouncement(accountId, authEpoch, postId, lease, replyTarget) {
  const context = useRef(null);
  const lifetime = useRef(null);
  const pending = useRef(null);
  const revoke = () => {
    const claim = pending.current;
    pending.current = null;
    if (claim?.timer != null) clearTimeout(claim.timer);
  };
  if (!context.current || context.current.accountId !== accountId || context.current.authEpoch !== authEpoch
      || context.current.postId !== postId || context.current.lease !== lease) {
    revoke();
    context.current = { accountId, authEpoch, postId, lease, replyTarget };
  } else if (context.current.replyTarget !== replyTarget) {
    if (pending.current?.validation) revoke();
    context.current.replyTarget = replyTarget;
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
  const eligible = () => lifetime.current && context.current === identity && !!accountId && !!lease
    && AppState.currentState === "active" && getConfirmedScreenReaderEnabled() === true;
  const current = claim => !!claim && pending.current === claim && claim.life === lifetime.current && eligible();
  return {
    begin(validation = false) {
      if (context.current !== identity) return null;
      revoke();
      if (!eligible()) return null;
      const claim = { life: lifetime.current, validation, timer: null, queued: false };
      pending.current = claim;
      return claim;
    },
    finish(claim, outcome) {
      if (!current(claim)) {
        if (claim && pending.current === claim) revoke();
        return;
      }
      if (claim.queued) return;
      const message = messages[outcome];
      if (!message) { revoke(); return; }
      claim.queued = true;
      claim.timer = setTimeout(() => {
        // A captured cancelled callback cannot clear a newer claim/timer.
        if (!current(claim)) {
          if (pending.current === claim) revoke();
          return;
        }
        pending.current = null; // Consume before native handoff, including throws.
        claim.timer = null;
        // RN cannot retract an announcement already handed to VoiceOver.
        // architecture: allow-empty-catch -- Optional native speech failure must not alter confirmed delivery or expose authored content.
        try { AccessibilityInfo.announceForAccessibilityWithOptions(message, { queue: true }); } catch {}
      }, 150);
    },
    cancel() { if (context.current === identity) revoke(); },
    cancelValidation() { if (context.current === identity && pending.current?.validation) revoke(); },
  };
}
