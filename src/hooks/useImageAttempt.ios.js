import useIOSDetailPresentation from "./useIOSDetailPresentation";
import { useCallback, useMemo, useRef, useState, useLayoutEffect } from "react";
import { advanceImageAttempt, displayImageAttempt, imageAttemptSources, initialImageAttempt } from "../domain/imageAttemptPolicy.mjs";

// iOS native callbacks have no URI. Each source lifetime gets a distinct native
// view key and generation, including A -> B -> A and same-URI explicit retries.
export default function useImageAttempt(identity, candidates, retryIntent = null) {
  const { active, current, token, scope: presentationScope, canAct = current, commandToken = token, privacyScope = null, privacyCurrent = () => true } = useIOSDetailPresentation();
  const presentationRef = useRef(null);
  presentationRef.current = { active, canAct, scope: presentationScope, privacyScope };
  const deferred = useRef(null);
  const candidateKey = JSON.stringify(candidates);
  const sources = useMemo(() => imageAttemptSources(JSON.parse(candidateKey)), [candidateKey]);
  const scope = JSON.stringify([identity, sources]);
  const stateRef = useRef(null);
  const generationRef = useRef(0);
  const lifetimeRef = useRef(null);
  const intentRef = useRef(retryIntent);
  intentRef.current = retryIntent;
  if (!stateRef.current || stateRef.current.scope !== scope) {
    deferred.current = null;
    lifetimeRef.current = {};
    stateRef.current = { ...initialImageAttempt(scope, sources), generation: ++generationRef.current };
  }
  const lifetime = lifetimeRef.current;
  const [, setRevision] = useState(0);
  const mountedRef = useRef(true);
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  useLayoutEffect(() => active ? retryIntent?.subscribe(() => {
    if (!canAct() || !privacyCurrent() || !mountedRef.current || intentRef.current !== retryIntent || lifetimeRef.current !== lifetime) return;
    // Consume at gesture acceptance, not a later render: an in-flight image
    // that fails before React commits must not borrow the earlier retry intent.
    if (!stateRef.current.exhausted) return;
    stateRef.current = { ...initialImageAttempt(stateRef.current.scope, sources), generation: ++generationRef.current };
    setRevision((revision) => revision + 1);
  }) : undefined, [retryIntent, sources, lifetime, active, token, commandToken, privacyScope]);
  const { index, exhausted, generation } = stateRef.current;
  const ownsSource = () => privacyCurrent() && mountedRef.current && stateRef.current.generation === generation
    && intentRef.current === retryIntent && presentationRef.current.scope === presentationScope && presentationRef.current.privacyScope === privacyScope;
  const defer = (kind) => {
    // A native request can finish while its real view is covered. Retain the
    // terminal result, but never change its source (and start another fetch)
    // until this exact source/owner is admitted again. Old callbacks arriving
    // after Back cannot borrow that newer admission.
    if (presentationRef.current.canAct()) return;
    if (kind === "error" && deferred.current?.generation === generation && deferred.current.kind === "display") return;
    deferred.current = { kind, scope, index, generation, retryIntent, presentationScope, privacyScope };
  };
  useLayoutEffect(() => {
    if (!active || !canAct() || !privacyCurrent()) return;
    const pending = deferred.current;
    deferred.current = null;
    if (!pending || pending.scope !== scope || pending.index !== index || pending.generation !== generation
      || pending.retryIntent !== retryIntent || pending.presentationScope !== presentationScope || pending.privacyScope !== privacyScope) return;
    const next = pending.kind === "display"
      ? displayImageAttempt(stateRef.current, { scope, index })
      : advanceImageAttempt(stateRef.current, { scope, index }, sources.length);
    if (next === stateRef.current) return;
    stateRef.current = pending.kind === "display" ? next : { ...next, generation: ++generationRef.current };
    setRevision((revision) => revision + 1);
  }, [active, token, commandToken, scope, index, generation, retryIntent, presentationScope, privacyScope]);
  const onError = useCallback((event) => {
    if (!ownsSource()) return;
    const reportedUri = event?.source?.uri || event?.nativeEvent?.source?.uri;
    if (reportedUri && reportedUri !== sources[index]) return;
    if (!canAct()) { defer("error"); return; }
    const next = advanceImageAttempt(stateRef.current, { scope, index }, sources.length);
    if (next === stateRef.current) return;
    stateRef.current = { ...next, generation: ++generationRef.current };
    setRevision((revision) => revision + 1);
  }, [scope, index, sources, generation, retryIntent, token, commandToken, presentationScope, privacyScope]);
  const onDisplay = useCallback(() => {
    if (!ownsSource()) return;
    if (!canAct()) { defer("display"); return; }
    stateRef.current = displayImageAttempt(stateRef.current, { scope, index });
  }, [scope, index, generation, retryIntent, token, commandToken, presentationScope, privacyScope]);
  return { uri: exhausted ? null : sources[index], index, onError, onDisplay, nativeAttemptKey: generation };
}
