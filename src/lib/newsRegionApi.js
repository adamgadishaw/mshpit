import { api } from "./api";

// Where a member's news comes from: "auto" (their home city's region), one
// region, or "everywhere". Loaded with the News screen, not at startup.
export function fetchNewsRegion({ signal } = {}) {
  return api("/api/me/news-region", { silent: true, signal, context: "Loading your news region" });
}

export async function saveNewsRegion({ accountId, choice }) {
  const payload = await api("/api/me/news-region", {
    method: "PUT", body: { choice }, expectedAccountId: accountId, silent: true, context: "Saving your news region",
  });
  if (!payload?.newsRegion || typeof payload.newsRegion.choice !== "string") throw new TypeError("The news region was not confirmed. Try again.");
  return payload.newsRegion;
}
