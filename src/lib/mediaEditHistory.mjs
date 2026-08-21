const DEFAULT_HISTORY_LIMIT = 40;

function safeLimit(value) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? Math.min(100, Math.max(1, parsed)) : DEFAULT_HISTORY_LIMIT;
}

function sameValue(left, right, equals) {
  return typeof equals === "function" ? equals(left, right) : Object.is(left, right);
}

export function createMediaEditHistory(initialValue, options = {}) {
  return {
    baseline: initialValue,
    past: [],
    present: initialValue,
    future: [],
    groupKey: null,
    limit: safeLimit(options.limit),
  };
}

export function commitMediaEditHistory(history, nextValue, options = {}) {
  const current = history || createMediaEditHistory(nextValue, options);
  if (sameValue(current.present, nextValue, options.equals)) return current;

  const groupKey = typeof options.groupKey === "string" && options.groupKey ? options.groupKey : null;
  if (groupKey && current.groupKey === groupKey) {
    return { ...current, present: nextValue, future: [] };
  }

  const past = [...current.past, current.present].slice(-safeLimit(current.limit));
  return { ...current, past, present: nextValue, future: [], groupKey };
}

export function sealMediaEditHistory(history) {
  return history?.groupKey ? { ...history, groupKey: null } : history;
}

export function undoMediaEditHistory(history) {
  if (!history?.past?.length) return sealMediaEditHistory(history);
  const past = history.past.slice();
  const present = past.pop();
  return {
    ...history,
    past,
    present,
    future: [history.present, ...history.future].slice(0, safeLimit(history.limit)),
    groupKey: null,
  };
}

export function redoMediaEditHistory(history) {
  if (!history?.future?.length) return sealMediaEditHistory(history);
  const [present, ...future] = history.future;
  return {
    ...history,
    past: [...history.past, history.present].slice(-safeLimit(history.limit)),
    present,
    future,
    groupKey: null,
  };
}

export function resetMediaEditHistory(history, options = {}) {
  if (!history || sameValue(history.present, history.baseline, options.equals)) return sealMediaEditHistory(history);
  return commitMediaEditHistory(sealMediaEditHistory(history), history.baseline, options);
}

export function mediaEditHistoryState(history, options = {}) {
  return {
    canUndo: !!history?.past?.length,
    canRedo: !!history?.future?.length,
    isDirty: !!history && !sameValue(history.present, history.baseline, options.equals),
  };
}
