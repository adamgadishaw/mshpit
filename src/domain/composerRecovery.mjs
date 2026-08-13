import { isComposerFrame, prepareNavigationFrame } from "./composerNavigation.mjs";

export const ACTIVE_COMPOSER_KEY = "pit.activeComposer";
export const PENDING_COMPOSER_PICKER_KEY = "pit.pendingComposerPicker";

export function restoreComposerFrame(activeFrame, pendingOwner, idFactory) {
  if (!isComposerFrame(activeFrame)) return null;
  const frame = prepareNavigationFrame(activeFrame, idFactory);
  if (pendingOwner?.composerId && pendingOwner.composerId === frame.composerId && pendingOwner.draftId && !frame.draftId) {
    return { ...frame, draftId: pendingOwner.draftId };
  }
  return frame;
}

export function pickerOwnerMatchesComposer(owner, frame) {
  return !!(owner?.requestId && owner?.composerId && isComposerFrame(frame) && owner.composerId === frame.composerId);
}
