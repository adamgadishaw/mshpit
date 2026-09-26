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
