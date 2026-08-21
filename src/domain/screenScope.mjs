const scopePart = (value) => value == null ? "" : String(value).trim();

// Screen-local drafts and async results are private to both the signed-in
// account and the thing being viewed. A JSON tuple keeps the boundary
// unambiguous even when either value contains punctuation.
export function accountTargetScope(accountId, targetId) {
  return JSON.stringify([scopePart(accountId), scopePart(targetId)]);
}

export function scopedScreenValue(state, scope, fallback) {
  return state?.scope === scope ? state.value : fallback;
}

export function isCurrentScreenRequest(active, expected) {
  return !!active && !!expected
    && active.sequence === expected.sequence
    && active.scope === expected.scope
    && active.target === expected.target;
}
