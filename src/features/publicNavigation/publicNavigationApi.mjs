const text = (value) => String(value ?? "").trim();

export async function resolvePublicEntity(path, { signal } = {}, { apiCall } = {}) {
  const pathname = text(path);
  if (!pathname.startsWith("/") || typeof apiCall !== "function") return null;
  const response = await apiCall("/api/resolve?path=" + encodeURIComponent(pathname), {
    signal,
    silent: true,
    context: "Opening public page",
  });
  return response?.entity || null;
}

export async function readPublicPost(id, { signal } = {}, { apiCall } = {}) {
  const postId = text(id);
  if (!postId || typeof apiCall !== "function") return null;
  const response = await apiCall("/api/posts/" + encodeURIComponent(postId), {
    signal,
    silent: true,
    context: "Opening shared post",
  });
  return response?.post || null;
}
