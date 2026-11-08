import { useCallback, useMemo, useRef, useState, useLayoutEffect } from "react";
import { advanceImageAttempt, displayImageAttempt, imageAttemptSources, initialImageAttempt } from "../domain/imageAttemptPolicy.mjs";

// iOS native callbacks have no URI. Each source lifetime gets a distinct native
// view key and generation, including A -> B -> A and same-URI explicit retries.
export default function useImageAttempt(identity, candidates, retryIntent = null) {
  const candidateKey = JSON.stringify(candidates);
  const sources = useMemo(() => imageAttemptSources(JSON.parse(candidateKey)), [candidateKey]);
  const scope = JSON.stringify([identity, sources]);
  const stateRef = useRef(null);
  const generationRef = useRef(0);
  const lifetimeRef = useRef(null);
  const intentRef = useRef(retryIntent);
  intentRef.current = retryIntent;
  if (!stateRef.current || stateRef.current.scope !== scope) {
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
  useLayoutEffect(() => retryIntent?.subscribe(() => {
    if (!mountedRef.current || intentRef.current !== retryIntent || lifetimeRef.current !== lifetime) return;
    // Consume at gesture acceptance, not a later render: an in-flight image
    // that fails before React commits must not borrow the earlier retry intent.
    if (!stateRef.current.exhausted) return;
    stateRef.current = { ...initialImageAttempt(stateRef.current.scope, sources), generation: ++generationRef.current };
    setRevision((revision) => revision + 1);
  }), [retryIntent, sources, lifetime]);
  const { index, exhausted, generation } = stateRef.current;
  const owns = () => mountedRef.current && stateRef.current.generation === generation && intentRef.current === retryIntent;
  const onError = useCallback((event) => {
    if (!owns()) return;
    const reportedUri = event?.source?.uri || event?.nativeEvent?.source?.uri;
    if (reportedUri && reportedUri !== sources[index]) return;
    const next = advanceImageAttempt(stateRef.current, { scope, index }, sources.length);
    if (next === stateRef.current) return;
    stateRef.current = { ...next, generation: ++generationRef.current };
    setRevision((revision) => revision + 1);
  }, [scope, index, sources, generation, retryIntent]);
  const onDisplay = useCallback(() => {
    if (owns()) stateRef.current = displayImageAttempt(stateRef.current, { scope, index });
  }, [scope, index, generation, retryIntent]);
  return { uri: exhausted ? null : sources[index], index, onError, onDisplay, nativeAttemptKey: generation };
}
