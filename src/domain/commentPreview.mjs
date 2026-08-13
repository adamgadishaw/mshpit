function commentTime(comment) {
  const value = Number(comment?.createdAt ?? comment?.at);
  return Number.isFinite(value) ? value : 0;
}

/**
 * A feed response's bounded preview is canonical for already-published rows.
 * Local state contributes only writes that have not received a server response;
 * otherwise a deleted/blocked comment cached on this device could reappear.
 */
export function inlineCommentPreview(serverPreview, localComments, { isBlocked = () => false } = {}) {
  const local = Array.isArray(localComments) ? localComments : [];
  if (!Array.isArray(serverPreview)) {
    return local.filter((comment) => comment?.id && !isBlocked(comment.userId));
  }

  const byId = new Map();
  for (const comment of local) {
    if (comment?.id && comment.pending && !isBlocked(comment.userId)) byId.set(comment.id, comment);
  }
  for (const comment of serverPreview) {
    if (comment?.id && !isBlocked(comment.userId)) byId.set(comment.id, comment);
  }
  return [...byId.values()].sort((left, right) => commentTime(left) - commentTime(right) || String(left.id).localeCompare(String(right.id)));
}
