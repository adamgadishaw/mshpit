import { useLayoutEffect, useRef, useState } from "react";
import { createIOSLinkedNavigation } from "../domain/iosLinkedNavigation.mjs";
import { normalizeFetchedNotificationPost, notificationPostFailureNotice, resolveNotificationPost } from "../domain/notificationDeepLink.mjs";

// Activity owns its lookup until a newer intent, account/epoch or layout cleanup.
// Keep this owner local: opening Activity must not change Store read semantics.
export default function useIOSActivityNavigation({
  accountId, authEpoch, feed, fetchPost, isCurrentRoute,
  onClose, onOpenProfile, onOpenThread, onOpenPost, onOpenPlans, onOpenArtist,
}) {
  const ownerRef = useRef(null);
  if (!ownerRef.current) ownerRef.current = createIOSLinkedNavigation();
  const owner = ownerRef.current;
  // This opaque scope also rejects old callbacks across A -> B -> A renders.
  const scope = owner.account(accountId, authEpoch);
  const feedbackRef = useRef(null);
  const [feedback, setFeedback] = useState(null);
  const publish = (value) => {
    feedbackRef.current = value;
    setFeedback(value);
  };
  useLayoutEffect(() => {
    owner.mount();
    publish(null);
    return () => owner.unmount();
  }, [owner]);

  // Root edge Back and tab changes can retire this frame before React commits
  // its unmount. The parent route claim closes that otherwise-live interval.
  const routeCurrent = () => !isCurrentRoute || isCurrentRoute();
  const ownsScope = () => owner.ownsScope(scope) && routeCurrent();
  const leave = (callback, value) => {
    if (!ownsScope()) return;
    // Retire the rendered controls synchronously, before parent navigation and
    // before passive unmount cleanup can run. Queued presses cannot reopen us.
    owner.invalidate();
    publish(null);
    callback?.(value);
  };
  const open = async (notification) => {
    if (!ownsScope()) return;
    const claim = owner.begin(scope);
    if (!claim) return;
    const current = () => owner.current(claim) && routeCurrent();
    const show = (openingNotificationId, unavailableNotice = null) => {
      if (current()) publish({ scope, openingNotificationId, unavailableNotice });
    };
    const destination = resolveNotificationPost(notification, feed);
    if (destination.kind !== "fetch-post") {
      show(null);
      if (destination.kind === "profile") return leave(onOpenProfile, destination.actorId);
      if (destination.kind === "thread") return leave(onOpenThread, destination.actorId);
      if (destination.kind === "plans") return leave(onOpenPlans);
      if (destination.kind === "artist") return leave(onOpenArtist, { name: destination.artist });
      if (destination.kind === "local-post") return leave(onOpenPost, destination.post);
      if (destination.kind === "unavailable") show(null, "This post is no longer available.");
      owner.release(claim);
      return;
    }

    show(notification.id);
    try {
      if (!current()) return;
      const payload = await fetchPost(destination, claim.controller);
      if (!current()) return;
      const post = normalizeFetchedNotificationPost(payload, destination.postId);
      if (!post) {
        show(null, "This post is no longer available.");
        return;
      }
      if (current()) leave(onOpenPost, post);
    } catch (error) {
      if (current()) show(null, notificationPostFailureNotice(error));
    } finally {
      // A cancelled completion must not release or clear a newer request/notice.
      owner.release(claim);
    }
  };

  const visible = feedback?.scope === scope ? feedback : null;
  return {
    open,
    cancelPending: () => { const claim = owner.begin(scope); owner.release(claim); publish(null); },
    close: () => leave(onClose),
    openProfile: (actorId) => leave(onOpenProfile, actorId),
    openingNotificationId: visible?.openingNotificationId ?? null,
    unavailableNotice: visible?.unavailableNotice ?? null,
    dismissNotice: () => {
      if (ownsScope() && visible?.unavailableNotice && feedbackRef.current === feedback) publish(null);
    },
  };
}
