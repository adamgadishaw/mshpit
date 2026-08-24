import { api } from "../../../lib/api";

export function searchPeopleRequest(query, { signal, postTagEligibleOnly = false, postId = null } = {}) {
  const params = new URLSearchParams({ q: String(query || "") });
  if (postTagEligibleOnly) {
    params.set("scope", "post_tag");
    const targetPostId = String(postId || "").trim();
    if (targetPostId) params.set("postId", targetPostId);
  }
  return api(`/api/people?${params.toString()}`, {
    signal,
    silent: true,
    context: postTagEligibleOnly ? "Searching friends to tag" : "Searching people",
  });
}
