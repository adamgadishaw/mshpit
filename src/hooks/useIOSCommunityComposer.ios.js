import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { EMPTY_MESSAGE_DRAFT, unavailableMessageDraft } from "../domain/iosMessageDrafts.mjs";

// Root retains text/one send claim only. Membership, Lounge entry, delivery and
// retries remain owned by the screen and Store, never by a remembered draft.
export default function useIOSCommunityComposer({ draftOwner, accountId, authEpoch,
  kind, target, enabled, isCurrentRoute }) {
  const lease = target && draftOwner ? draftOwner.lease(JSON.stringify([kind, target])) : unavailableMessageDraft;
  const snapshot = useSyncExternalStore(lease.subscribe, lease.read, () => EMPTY_MESSAGE_DRAFT);
  const context = useRef(null);
  const [, redraw] = useState(0);
  const key = JSON.stringify([accountId, authEpoch, kind, target]);
  // Capacity admission may replace an unavailable lease without retiring this
  // route or its pending entry/join. Old unavailable/evicted leases are inert.
  if (!context.current || context.current.key !== key
    || (context.current.isCurrentRoute && !context.current.isCurrentRoute())) {
    context.current = { key, isCurrentRoute,
      presentation: { active: false, retired: false }, gate: { enabled: !!enabled } };
  }
  const owner = context.current;
  if (owner.gate.enabled !== !!enabled) owner.gate = { enabled: !!enabled };
  const presentation = owner.presentation, gate = owner.gate;
  const ownsRoute = () => context.current === owner && (!isCurrentRoute || isCurrentRoute());
  const current = () => ownsRoute() && owner.presentation === presentation && presentation.active;
  const admitted = () => current() && owner.gate === gate && gate.enabled;
  useLayoutEffect(() => {
    if (owner.presentation.retired) owner.presentation = { active: true, retired: false };
    else owner.presentation.active = true;
    redraw(value => value + 1);
    return () => {
      owner.presentation.active = false;
      owner.presentation.retired = true;
    };
  }, [owner]);

  return {
    ...snapshot,
    canCompose: !!enabled && !snapshot.unavailable,
    current,
    ownsRoute,
    // Revoke admission when membership changes or a room closes, before React
    // renders. Owned eligibility reads/timers can settle while hidden too.
    pause() { if (ownsRoute()) owner.gate = { enabled: false }; },
    edit(value) { if (admitted()) lease.edit(value); },
    async send(command) {
      if (!admitted()) return;
      const claim = lease.claim();
      if (!claim) return;
      try { lease.settle(claim, await command(claim.text)); }
      catch { lease.settle(claim, { ok: false }); }
      // Settlement belongs to the Root lease, not this presentation. Navigation
      // and Suspense must not cancel an already accepted Store operation.
    },
    async retry(message, command) {
      if (!admitted() || !message?.failed || message.userId !== accountId) return;
      const before = lease.read();
      try {
        const result = await command(message.id);
        if (result?.ok) lease.clearMatching(before, message.text);
      } catch { /* Store owns failed delivery; retain the exact draft. */ }
    },
    cancel(message, command) {
      if (admitted() && message?.failed && message.userId === accountId) return command(message.id);
    },
  };
}
