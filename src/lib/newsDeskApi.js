import { api } from "./api";

// Confirmed music news from the news desk. A read: views show their own empty
// and error states, so the call stays silent.
// `artist` narrows the list to stories about one catalogue artist (its key);
// `sort: "top"` asks for top stories (score plus engagement) instead of newest.
export function fetchNewsDeskStories({ cursor = null, limit = 20, artist = null, sort = "latest", signal } = {}) {
  const params = new URLSearchParams();
  if (artist) params.set("artist", artist);
  if (sort === "top") params.set("sort", "top");
  if (cursor) params.set("cursor", cursor);
  if (limit !== 20) params.set("limit", String(limit));
  const query = params.toString();
  return api(`/api/news-desk/stories${query ? `?${query}` : ""}`, { silent: true, signal, context: "Loading music news" });
}

// One post by id, for opening a story's post and comments.
export function fetchPostById(id, { signal } = {}) {
  return api(`/api/posts/${encodeURIComponent(id)}`, { silent: true, signal, context: "Opening a news story" });
}

export function requestNewsIntroduction({ accountId, requestId, signal }) {
  return api("/api/feed/news-introduction", { method: "POST", body: { requestId }, expectedAccountId: accountId, signal, silent: true, context: "Preparing news from artists you follow" });
}
