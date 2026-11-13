import { useLayoutEffect, useRef, useState } from "react";
import { createIOSLinkedNavigation } from "../../domain/iosLinkedNavigation.mjs";
import { fetchLocalAlertEvent } from "./localAlertService";

export default function useLocalAlertNavigation({ accountId, authEpoch, isCurrent, onOpen }) {
  const ref = useRef(null);
  if (!ref.current) ref.current = createIOSLinkedNavigation();
  const owner = ref.current, scope = owner.account(accountId, authEpoch);
  const [feedback, setFeedback] = useState(null);
  const active = useRef(null);
  useLayoutEffect(() => { owner.mount(); return () => owner.unmount(); }, [owner]);
  const currentScope = () => owner.ownsScope(scope) && isCurrent();
  return {
    feedback: feedback?.scope === scope ? feedback : null,
    cancel: () => { owner.release(active.current); setFeedback(null); },
    async open(notification) {
      if (!currentScope()) return;
      const claim = owner.begin(scope);
      if (!claim) return;
      active.current = claim;
      const current = () => owner.current(claim) && isCurrent();
      setFeedback({ scope, id: notification.id });
      try {
        const event = await fetchLocalAlertEvent({ accountId, alertId: notification.alertId, signal: claim.controller.signal });
        if (current()) { owner.invalidate(); setFeedback(null); onOpen(event); }
      } catch (error) {
        if (current()) setFeedback({ scope, error: error?.status === 404 ? "This show update is no longer available." : "Couldn't open this show update. Try again." });
      } finally { owner.release(claim); }
    },
  };
}
