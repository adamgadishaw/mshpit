import { api } from "../../../lib/api";

export function removeMyPostTagRequest(postId, { signal, expectedAccountId } = {}) {
  return api(`/api/posts/${encodeURIComponent(postId)}/tags/me`, {
    method: "DELETE",
    context: "Removing your tag",
    signal,
    expectedAccountId,
  });
}
