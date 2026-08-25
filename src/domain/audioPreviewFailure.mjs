export function classifyAudioPlayRejection(reason) {
  const name = typeof reason?.name === "string" ? reason.name : "";
  // pause(), load(), source replacement and teardown intentionally interrupt a
  // pending play() promise. That is lifecycle cancellation, not broken media.
  if (name === "AbortError") return null;
  if (name === "NotAllowedError") return { kind: "permission" };
  return { kind: "playback" };
}

export function audioPreviewLeaseMatches(active, candidate) {
  return !!active
    && !!candidate
    && active.element === candidate.element
    && active.mediaKey === candidate.mediaKey
    && active.source === candidate.source
    && active.generation === candidate.generation;
}
