export function composerCloseDecision({ busy = false, editing = false, dirty = false, hasContent = false, hasDraft = false } = {}) {
  if (busy) return "block";
  if (editing && dirty) return "confirm-edit-discard";
  if (!editing && dirty && hasContent) return "confirm-draft-close";
  if (!editing && hasDraft && !hasContent) return "delete-empty-draft";
  return "allow";
}
