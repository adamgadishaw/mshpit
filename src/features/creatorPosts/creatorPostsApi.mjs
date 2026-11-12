import { api } from "../../lib/api";
import { AppError } from "../../lib/diagnostics";

export async function fetchManagedCreatorEntities({ accountId, signal }, { apiCall = api } = {}) {
  const result = await apiCall("/api/me/creator-entities", { expectedAccountId: accountId, signal, silent: true, context: "Loading your pages" });
  if (!Array.isArray(result?.entities)) throw new AppError("Your pages could not be confirmed. Try again.");
  return result.entities;
}

export async function fetchCreatorPosts({ entityType, entityKey, accountId, signal }) {
  const result = await api(`/api/creators/${entityType}/${encodeURIComponent(entityKey)}/posts`, { expectedAccountId: accountId, signal, silent: true, context: "Loading page updates" });
  if (!Array.isArray(result?.posts)) throw new AppError("Page updates could not be loaded. Try again.");
  return result.posts;
}

export async function fetchCreatorPreference({ entityType, entityKey, accountId, signal }) {
  return api(`/api/creators/${entityType}/${encodeURIComponent(entityKey)}/follow`, { expectedAccountId: accountId, signal, silent: true, context: "Loading update preferences" });
}

export async function setCreatorUpdatePreference({ entityType, entityKey, accountId, notifyUpdates, signal }) {
  return api(`/api/creators/${entityType}/${encodeURIComponent(entityKey)}/notifications`, { method: "PUT", body: { notifyUpdates }, expectedAccountId: accountId, signal, silent: true, context: "Saving update preferences" });
}

export async function fetchArtistCalendar({ accountId, after = "", signal }) {
  const result = await api(`/api/me/artist-calendar?after=${encodeURIComponent(after)}`, { expectedAccountId: accountId, signal, silent: true, context: "Loading your calendar" });
  if (!Array.isArray(result?.events)) throw new AppError("Your calendar could not be confirmed.");
  return result;
}
