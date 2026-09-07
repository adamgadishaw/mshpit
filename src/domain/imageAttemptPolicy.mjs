// One request per distinct rendition. In particular, an already-proxied URL
// must not be tried twice when its preferred and fallback paths are identical.
export function imageAttemptSources(candidates = []) {
  return [...new Set(candidates.filter((uri) => typeof uri === "string" && uri.trim()).map((uri) => uri.trim()))];
}

export function initialImageAttempt(scope, sources = []) {
  return { scope, index: 0, ready: false, exhausted: sources.length === 0 };
}

export function imageAttemptOwnsEvent(state, event) {
  return !!state && !!event && state.scope === event.scope && state.index === event.index;
}

export function advanceImageAttempt(state, event, sourceCount) {
  // Image libraries can deliver an old request's error after a new source is
  // mounted. A displayed image also cannot be invalidated by a late error.
  if (!imageAttemptOwnsEvent(state, event) || state.ready || state.exhausted) return state;
  const index = state.index + 1;
  return { ...state, index, ready: false, exhausted: index >= sourceCount };
}

export function displayImageAttempt(state, event) {
  if (!imageAttemptOwnsEvent(state, event) || state.ready || state.exhausted) return state;
  return { ...state, ready: true };
}
