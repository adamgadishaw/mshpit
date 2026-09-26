import { api } from "./api";

// Confirmed music news from the news desk. A read: views show their own empty
// and error states, so the call stays silent.
export function fetchNewsDeskStories({ cursor = null, limit = 20, signal } = {}) {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  if (limit !== 20) params.set("limit", String(limit));
  const query = params.toString();
  return api(`/api/news-desk/stories${query ? `?${query}` : ""}`, { silent: true, signal, context: "Loading music news" });
}

// One post by id, for opening a story's post and comments.
export function fetchPostById(id, { signal } = {}) {
  return api(`/api/posts/${encodeURIComponent(id)}`, { silent: true, signal, context: "Opening a news story" });
}
