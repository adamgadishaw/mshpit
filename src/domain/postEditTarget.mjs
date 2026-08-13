export function resolvePostEditTarget(feed, target) {
  const id = typeof target === "string" ? target : target?.id;
  if (!id) return null;
  const live = Array.isArray(feed) ? feed.find((post) => post?.id === id) : null;
  return live || (target && typeof target === "object" ? target : null);
}

export function mergeEditedPost(feed, updated) {
  const current = Array.isArray(feed) ? feed : [];
  if (!updated?.id) return current;
  let replaced = false;
  const next = current.map((post) => {
    if (post?.id !== updated.id) return post;
    replaced = true;
    return updated;
  });
  return replaced ? next : [updated, ...next];
}
