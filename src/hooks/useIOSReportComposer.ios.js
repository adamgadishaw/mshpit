import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Alert } from "react-native";

const empty = () => ({ status: null, duplicate: false, selected: null, details: "", blockStatus: null });
const unconfirmed = "Your report could not be confirmed. Your reason and details are kept here.";
const signInRequired = "Log in to send this to the moderators.";

// Private to this mounted form. Nothing is cached, persisted, or retried.
export default function useIOSReportComposer({ accountId, authEpoch, target, targetType, targetId,
  reasons, reportContent, blockUser, isBlocked, onClose, closeGuardRef, isCurrentRoute }) {
  const context = useRef(null);
  const [, redraw] = useState(0);
  const key = JSON.stringify([accountId, authEpoch, targetType, targetId, target.mediaUri || null, target.ownerId || null]);
  if (!context.current || context.current.key !== key || (context.current.isCurrentRoute && !context.current.isCurrentRoute())) {
    if (context.current) {
      // Drop private text and revoke old callbacks even on an unkeyed A-B-A.
      context.current.state = empty();
      context.current.life = null;
      context.current.work = context.current.pending = null;
    }
    context.current = { key, isCurrentRoute, state: empty(), presentation: { active: false, retired: false }, registered: false, life: null, work: null, pending: null, dispatching: false, bypass: false };
  }
  const owner = context.current;
  const presentation = owner.presentation;
  const owned = () => context.current === owner && (!isCurrentRoute || isCurrentRoute());
  const live = () => owned() && !!owner.life;
  const actionLive = () => live() && owner.presentation === presentation && presentation.active;
  const update = patch => { owner.state = { ...owner.state, ...patch }; redraw(value => value + 1); };
  const dispatch = action => {
    if (!owned() || owner.dispatching) return;
    owner.pending = null;
    owner.dispatching = true;
    try { action?.(); } catch {
      // A navigation failure never turns a confirmed report into a resend.
      return;
    } finally { owner.dispatching = false; }
  };
  const guard = ({ proceed = () => {}, cancel = () => {} } = {}) => {
    if (!owned() || !owner.registered) { cancel(); return; }
    if (!owner.life) {
      // Suspense can hide the form without cancelling its work. Root Back
      // waits for a dirty/busy form to return; pristine/confirmed forms may go.
      if (owner.work || (owner.state.status !== "sent" && (owner.state.selected || owner.state.details))) cancel();
      else dispatch(proceed);
      return;
    }
    if (owner.bypass) { owner.bypass = false; proceed(); return; }
    if (owner.dispatching || owner.pending) { cancel(); return; }
    const token = { life: owner.life };
    const current = () => live() && owner.life === token.life && owner.pending === token;
    if (owner.work) {
      cancel();
      owner.pending = token;
      const dismiss = () => { if (current()) owner.pending = null; };
      Alert.alert("Report action in progress", "Wait for your report or account block to finish before leaving.",
        [{ text: "OK", onPress: dismiss }], { cancelable: true, onDismiss: dismiss });
      return;
    }
    if (owner.state.status === "sent" || (!owner.state.selected && !owner.state.details)) { dispatch(proceed); return; }
    owner.pending = token;
    const finish = discard => {
      if (!current()) return;
      owner.pending = null;
      if (!discard || owner.work) { cancel(); return; }
      dispatch(proceed);
    };
    Alert.alert("Discard report?", "This discards your local reason and details. It does not withdraw any report already received by moderators.", [
      { text: "Keep editing", style: "cancel", onPress: () => finish(false) },
      { text: "Discard", style: "destructive", onPress: () => finish(true) },
    ], { cancelable: true, onDismiss: () => finish(false) });
  };
  owner.guard = guard;
  if (!owner.registeredGuard) owner.registeredGuard = options => owner.guard(options);
  const registeredGuard = owner.registeredGuard;
  useLayoutEffect(() => {
    const life = {};
    owner.life = life;
    owner.registered = true;
    if (owner.presentation.retired) owner.presentation = { active: true, retired: false };
    else owner.presentation.active = true;
    // A preserved form may have settled while its layout effects were hidden.
    redraw(value => value + 1);
    if (closeGuardRef) closeGuardRef.current = registeredGuard;
    return () => {
      if (owner.life === life) {
        owner.life = null;
        owner.presentation.active = false;
        owner.presentation.retired = true;
        // A layout disconnect is not cancellation of a Store command. Keep its
        // barrier through StrictMode/Suspense until it actually settles.
        owner.pending = null;
      }
    };
  }, [owner, closeGuardRef]);
  // Unlike layout effects, this registration survives a Suspense hide. Only
  // genuine unmount/owner replacement removes it, without erasing a successor.
  useEffect(() => {
    owner.registered = true;
    return () => {
      owner.registered = false;
      if (closeGuardRef?.current === registeredGuard) closeGuardRef.current = null;
    };
  }, [owner, closeGuardRef]);

  const editable = () => actionLive() && !owner.dispatching && !owner.work && !owner.pending && owner.state.status !== "sent";
  const begin = kind => {
    if (!actionLive() || owner.dispatching || owner.work || owner.pending) return null;
    const claim = { kind, life: owner.life };
    owner.work = claim;
    return claim;
  };
  const current = claim => owned() && owner.work === claim;
  const finish = (claim, patch) => {
    if (!current(claim)) return;
    owner.work = owner.pending = null;
    owner.state = { ...owner.state, ...patch };
    if (owner.life) redraw(value => value + 1);
  };
  return {
    ...owner.state,
    busy: !!owner.work,
    select(value) { if (editable()) update({ selected: value, status: null }); },
    changeDetails(value) { if (editable()) update({ details: value }); },
    async submit() {
      if (!editable() || !targetId) return;
      const { selected, details } = owner.state;
      const reason = reasons.find(([name]) => name === selected)?.[1];
      if (!reason) { update({ status: "Choose a reason first." }); return; }
      const claim = begin("report");
      if (!claim) return;
      update({ status: "sending" });
      try {
        const result = await reportContent(targetId, reason, targetType, { mediaUri: target.mediaUri || null, category: selected, details });
        finish(claim, result?.ok === true && typeof result.id === "string" && result.id.trim() ? { status: "sent", duplicate: !!result.duplicate }
          : { status: result?.error === signInRequired ? signInRequired : unconfirmed });
      } catch {
        finish(claim, { status: unconfirmed });
      }
    },
    async block() {
      if (owner.state.status !== "sent" || owner.state.blockStatus === "blocked"
        || !target.ownerId || target.ownerId === accountId || isBlocked(target.ownerId)) return;
      const claim = begin("block");
      if (!claim) return;
      update({ blockStatus: "blocking" });
      try {
        const result = await blockUser(target.ownerId);
        finish(claim, { blockStatus: result?.ok === true ? "blocked" : "failed" });
      } catch {
        finish(claim, { blockStatus: "failed" });
      }
    },
    close() { if (!actionLive()) return; guard({ proceed: () => {
      owner.bypass = true;
      try { onClose?.(); } finally { owner.bypass = false; }
    } }); },
  };
}
