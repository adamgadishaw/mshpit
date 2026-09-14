import { normalizePublicEventSnapshot } from "../../domain/publicEventSnapshot.mjs";
import { eventPath } from "../../domain/urls.mjs";

export async function readPublicEventSnapshot({ eventId, accountId = null, signal } = {}, { apiCall } = {}) {
  if (typeof eventId !== "string" || !eventId.trim() || eventId.length > 180 || typeof apiCall !== "function") return null;
  const response = await apiCall(`/api/resolve?path=${encodeURIComponent(eventPath(eventId))}`, {
    signal,
    silent: true,
    context: "Loading public event details",
    expectedAccountId: accountId,
  });
  return normalizePublicEventSnapshot(response?.entity, eventId);
}
