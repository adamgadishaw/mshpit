export async function saveMemoryPostEdit(postId, body, { apiClient, signal } = {}) {
  const id = String(postId || "").trim();
  if (!id) throw new TypeError("A fan-memory post id is required.");
  if (typeof apiClient !== "function") throw new TypeError("A fan-memory API client is required.");
  const response = await apiClient(`/api/posts/${encodeURIComponent(id)}`, {
    method: "PATCH",
    context: "Saving your fan memory",
    body,
    signal,
    silent: true,
  });
  if (!response?.post || typeof response.post !== "object" || Array.isArray(response.post)) {
    throw new TypeError("The saved fan-memory response was invalid.");
  }
  return response.post;
}
