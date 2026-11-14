import { api } from "./api";

export function saveArtistFollowing(key, following, { accountId, signal } = {}) {
  return api(`/api/artists/${encodeURIComponent(key)}/follow`, { method: "POST", body: { following }, expectedAccountId: accountId, signal, context: following ? "Following this artist" : "Unfollowing this artist" });
}
