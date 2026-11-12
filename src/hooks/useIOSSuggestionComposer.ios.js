import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { createSuggestionClientMutationId, parseSuggestionConfirmation, suggestionFailureMessage } from "../domain/suggestionBox.mjs";

const empty = () => ({ category: "idea", body: "", includeSurface: false,
  clientMutationId: createSuggestionClientMutationId(), attempted: false, error: "", confirmation: null });
const dirty = state => !state.confirmation && (!!state.body || state.category !== "idea" || state.includeSurface);
const unconfirmed = () => suggestionFailureMessage({ name: "SuggestionConfirmationError" });

// Ownership is private local state, never part of the anonymous submission.
export default function useIOSSuggestionComposer({ accountId, authEpoch, safeInitialSurface,
  submitSuggestion, onClose, closeGuardRef, isCurrentRoute }) {
  const context = useRef(null);
  const [, redraw] = useState(0);
  const key = JSON.stringify([accountId, authEpoch, safeInitialSurface]);
  if (!context.current || context.current.key !== key || (context.current.isCurrentRoute && !context.current.isCurrentRoute())) {
    if (context.current) {
      context.current.state = empty();
      context.current.life = context.current.work = context.current.pending = null;
    }
    context.current = { key, isCurrentRoute, state: empty(), presentation: { active: false, retired: false },
      registered: false, life: null, work: null, pending: null, dispatching: false, bypass: false };
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
      // A failed/no-op navigation leaves the draft or confirmation usable.
      return;
    } finally { owner.dispatching = false; }
  };
  const guard = ({ proceed = () => {}, cancel = () => {} } = {}) => {
    if (!owned() || !owner.registered) { cancel(); return; }
    if (!owner.life) {
      // A Suspense hide disconnects controls, not an in-flight delivery.
      if (owner.work || dirty(owner.state)) cancel();
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
      Alert.alert("Suggestion sending", "Wait for your suggestion to finish before leaving.",
        [{ text: "OK", onPress: dismiss }], { cancelable: true, onDismiss: dismiss });
      return;
    }
    if (!dirty(owner.state)) { dispatch(proceed); return; }
    owner.pending = token;
    const finish = discard => {
      if (!current()) return;
      owner.pending = null;
      if (!discard || owner.work) { cancel(); return; }
      dispatch(proceed);
    };
    Alert.alert("Discard suggestion?", "This discards your local draft. It does not remove any suggestion already received.", [
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
    redraw(value => value + 1);
    if (closeGuardRef) closeGuardRef.current = registeredGuard;
    return () => {
      if (owner.life !== life) return;
      owner.life = null;
      owner.presentation.active = false;
      owner.presentation.retired = true;
      owner.pending = null;
    };
  }, [owner, closeGuardRef]);
  // Retain Root's barrier while hidden; true unmount cannot erase a successor.
  useEffect(() => {
    owner.registered = true;
    return () => {
      owner.registered = false;
      if (closeGuardRef?.current === registeredGuard) closeGuardRef.current = null;
    };
  }, [owner, closeGuardRef]);

  const editable = () => actionLive() && !owner.dispatching && !owner.work && !owner.pending && !owner.state.confirmation;
  const edit = patch => {
    if (!editable()) return;
    update({ ...patch, error: "", ...(owner.state.attempted
      ? { attempted: false, clientMutationId: createSuggestionClientMutationId() } : {}) });
  };
  const finish = (claim, patch) => {
    if (!owned() || !owner.registered || owner.work !== claim) return;
    owner.work = owner.pending = null;
    owner.state = { ...owner.state, ...patch };
    if (owner.life) redraw(value => value + 1);
  };
  return {
    ...owner.state,
    busy: !!owner.work,
    chooseCategory(value) { if (value !== owner.state.category) edit({ category: value }); },
    changeBody(value) { edit({ body: value }); },
    toggleSurface() { if (safeInitialSurface) edit({ includeSurface: !owner.state.includeSurface }); },
    async send() {
      if (!editable()) return;
      const claim = {};
      owner.work = claim;
      const { category, body, clientMutationId, includeSurface } = owner.state;
      update({ error: "", attempted: true });
      try {
        const result = await submitSuggestion({ category, body, clientMutationId,
          ...(includeSurface && safeInitialSurface ? { surface: safeInitialSurface } : {}) });
        // The service returns a normalized durable receipt, not { ok, id }.
        const receipt = parseSuggestionConfirmation(result, clientMutationId);
        const confirmed = receipt && result.clientMutationId === receipt.clientMutationId
          && result.reference === receipt.reference && result.duplicate === receipt.duplicate && result.ok !== false;
        finish(claim, confirmed ? { confirmation: receipt, body: "" } : { error: unconfirmed() });
      } catch (error) {
        // Validation and rate limits keep canonical copy. Other outcomes may
        // have reached the server; an unchanged retry keeps this delivery key.
        const knownFailure = error?.name === "SuggestionValidationError" || error?.serverCode === "VALIDATION_FAILED"
          || error?.serverCode === "RATE_LIMITED" || Number(error?.status) === 429;
        finish(claim, { error: knownFailure ? suggestionFailureMessage(error) : unconfirmed() });
      }
    },
    close() { if (!actionLive()) return; guard({ proceed: () => {
      owner.bypass = true;
      try { onClose?.(); } finally { owner.bypass = false; }
    } }); },
  };
}
