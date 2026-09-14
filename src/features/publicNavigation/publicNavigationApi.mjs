const text = (value) => String(value ?? "").trim();

export async function resolveNavigationArtist(name, { signal } = {}, { apiCall } = {}) {
  const label = text(name);
  if (!label || label.length > 200 || typeof apiCall !== "function") return null;
  const result = await apiCall(`/api/artists/resolve?name=${encodeURIComponent(label)}`, {
    signal, silent: true, context: "Opening artist page",
  });
  return result?.artist ? { ...result.artist, transient: result.transient === true } : null;
}

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
