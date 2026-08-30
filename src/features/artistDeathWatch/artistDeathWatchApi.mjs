import { api } from "../../lib/api";

const candidate = (value) => value && typeof value === "object" && typeof value.artistKey === "string"
  && typeof value.artistName === "string" && typeof value.artistMbid === "string"
  && typeof value.wikidataId === "string" && typeof value.deathDate === "string"
  && Array.isArray(value.evidence) ? value : null;

export async function readArtistDeathWatch({ accountId, signal, status = "pending" } = {}) {
  const response = await api(`/api/moderation/artist-death-watch?status=${encodeURIComponent(status)}&limit=100`, {
    signal,
    silent: true,
    context: "Loading artist alerts",
    expectedAccountId: accountId,
  });
  return {
    settings: response?.settings || null,
    counts: response?.counts || { pending: 0, dismissed: 0, memorialized: 0 },
    eligibleArtists: Number(response?.eligibleArtists) || 0,
    providerPolicy: response?.providerPolicy || null,
    candidates: (Array.isArray(response?.candidates) ? response.candidates : []).map(candidate).filter(Boolean),
  };
}

export async function setArtistDeathWatchEnabled(enabled, { accountId, signal } = {}) {
  return api("/api/admin/artist-death-watch/settings", {
    method: "PATCH",
    body: { enabled: !!enabled },
    signal,
    silent: true,
    context: "Updating artist alerts",
    expectedAccountId: accountId,
  });
}

export async function runArtistDeathWatch({ accountId, signal } = {}) {
  return api("/api/admin/artist-death-watch/scan", {
    method: "POST",
    body: {},
    signal,
    silent: true,
    context: "Checking artist sources",
    expectedAccountId: accountId,
  });
}

export async function reviewArtistDeathCandidate(artistKey, status, { accountId, signal } = {}) {
  return api(`/api/moderation/artist-death-watch/${encodeURIComponent(artistKey)}`, {
    method: "PATCH",
    body: { status },
    signal,
    silent: true,
    context: "Reviewing artist alert",
    expectedAccountId: accountId,
  });
}
