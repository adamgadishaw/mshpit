export function isComposerFrame(frame) {
  return !!(frame?.logging || frame?.editingPost);
}

export function createComposerId(now = Date.now(), random = Math.random()) {
  return `composer_${Number(now).toString(36)}_${Number(random).toString(36).slice(2, 10)}`;
}

export function prepareNavigationFrame(frame, idFactory = createComposerId) {
  if (!isComposerFrame(frame) || frame.composerId) return frame;
  return { ...frame, composerId: idFactory() };
}

export function isActiveComposer(stack, composerId) {
  if (!composerId || !Array.isArray(stack) || !stack.length) return false;
  const top = stack[stack.length - 1];
  return isComposerFrame(top) && top.composerId === composerId;
}

export function composerNavigationExitAction(frame, requestedAction) {
  return isComposerFrame(frame) ? "guard" : requestedAction;
}

export function composerNavigationTransition(frame) {
  return isComposerFrame(frame) ? "replace" : "push";
}
