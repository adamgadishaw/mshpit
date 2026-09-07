import { useCallback, useMemo, useRef, useState } from "react";
import { advanceImageAttempt, displayImageAttempt, imageAttemptSources, initialImageAttempt } from "../domain/imageAttemptPolicy.mjs";

// Instance-only delivery state: no image bytes, URLs, or viewer identity are
// persisted or shared across accounts. The render-time fence protects recycled
// list cells even before React commits their next effects.
export default function useImageAttempt(identity, candidates) {
  const candidateKey = JSON.stringify(candidates);
  const sources = useMemo(() => imageAttemptSources(JSON.parse(candidateKey)), [candidateKey]);
  const scope = JSON.stringify([identity, sources]);
  const stateRef = useRef(null);
  if (!stateRef.current || stateRef.current.scope !== scope) {
    stateRef.current = initialImageAttempt(scope, sources);
  }
  const [, setRevision] = useState(0);
  const { index, exhausted } = stateRef.current;
  const onError = useCallback((event) => {
    // Expo Image's web errors identify the request that failed. Its native
    // callback has no source, so the captured scope/index remains the fence.
    const reportedUri = event?.source?.uri || event?.nativeEvent?.source?.uri;
    if (reportedUri && reportedUri !== sources[index]) return;
    const next = advanceImageAttempt(stateRef.current, { scope, index }, sources.length);
    if (next === stateRef.current) return;
    // Fence another synchronous/late callback before the state update renders.
    stateRef.current = next;
    setRevision((revision) => revision + 1);
  }, [scope, index, sources]);
  const onDisplay = useCallback(() => {
    stateRef.current = displayImageAttempt(stateRef.current, { scope, index });
  }, [scope, index]);
  return { uri: exhausted ? null : sources[index], index, onError, onDisplay };
}
