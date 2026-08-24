import { api } from "../../../lib/api";

export function removeMyPostTagRequest(postId, { signal } = {}) {
  return api(`/api/posts/${encodeURIComponent(postId)}/tags/me`, {
    method: "DELETE",
    context: "Removing your tag",
    signal,
  });
}
