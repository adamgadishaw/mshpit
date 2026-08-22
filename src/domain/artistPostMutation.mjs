export function reconcileConfirmedArtistPostRemoval(groups, { artistKey, postId } = {}) {
  const current = groups && typeof groups === "object" ? groups : {};
  const key = typeof artistKey === "string" ? artistKey.trim() : "";
  const id = typeof postId === "string" ? postId.trim() : "";
  if (!key || !id || !Array.isArray(current[key])) return current;
  const rows = current[key];
  const nextRows = rows.filter((post) => post?.id !== id);
  return nextRows.length === rows.length ? current : { ...current, [key]: nextRows };
}
