import { api } from "./api";
export function fetchConnections(userId, kind, { query = "", filter = "all", cursor = null, accountId = null, signal } = {}) {
  const route = kind === "artists" ? "artist-following" : kind === "following" ? "following" : "followers";
  const params = new URLSearchParams({ q: query, filter: kind === "artists" ? "all" : filter, limit: "30" });
  if (cursor) params.set("cursor", cursor);
  return api(`/api/users/${encodeURIComponent(userId)}/${route}?${params}`, { signal, silent: true, expectedAccountId: accountId, context: "Loading profile connections" });
}
export function saveArtistFollowing(key, following, { accountId, signal } = {}) {
  return api(`/api/artists/${encodeURIComponent(key)}/follow`, { method: "POST", body: { following }, expectedAccountId: accountId, signal, context: following ? "Following this artist" : "Unfollowing this artist" });
}
