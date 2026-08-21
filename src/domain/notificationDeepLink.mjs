const text = (value) => typeof value === "string" ? value.trim() : "";

export function notificationDestination(notification) {
  if (!notification || notification.type === "welcome") return { kind: "none" };
  if (notification.type === "follow") return text(notification.actorId)
    ? { kind: "profile", actorId: text(notification.actorId) }
    : { kind: "none" };
  if (notification.type === "dm") return text(notification.actorId)
    ? { kind: "thread", actorId: text(notification.actorId) }
    : { kind: "none" };
  if (notification.type === "like" || notification.type === "comment") return text(notification.postId)
    ? { kind: "post", postId: text(notification.postId) }
    : { kind: "unavailable" };
  return text(notification.actorId)
    ? { kind: "profile", actorId: text(notification.actorId) }
    : { kind: "none" };
}

export function resolveNotificationPost(notification, feed) {
  const destination = notificationDestination(notification);
  if (destination.kind !== "post") return destination;
  const post = (Array.isArray(feed) ? feed : []).find((candidate) => String(candidate?.id || "") === destination.postId);
  return post ? { kind: "local-post", post } : { kind: "fetch-post", postId: destination.postId };
}

export function normalizeFetchedNotificationPost(payload, expectedPostId) {
  const post = payload?.post;
  const expected = text(expectedPostId);
  if (!post || typeof post !== "object" || !expected || String(post.id || "") !== expected) return null;
  return {
    ...post,
    photos: Array.isArray(post.photos) ? post.photos : [],
    media: Array.isArray(post.media) ? post.media : [],
    mediaAssetIds: Array.isArray(post.mediaAssetIds) ? post.mediaAssetIds : [],
    setlist: Array.isArray(post.setlist) ? post.setlist : [],
  };
}

export function isCurrentNotificationPostRequest(active, { sequence, accountId, postId } = {}) {
  return !!active
    && active.sequence === sequence
    && String(active.accountId || "") === String(accountId || "")
    && active.postId === text(postId)
    && !active.controller?.signal?.aborted;
}

export function notificationPostFailureNotice(error) {
  const status = Number(error?.status) || 0;
  if (status === 403 || status === 404 || status === 410) {
    return "This post is no longer available.";
  }
  return "This post couldn't load. Check your connection and try again.";
}
