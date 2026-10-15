import { normalizePublicVenueSnapshot } from "../../domain/publicVenueSnapshot.mjs";

export async function fetchPublicVenueSnapshot({ path, identity, after = null, accountId = null, signal }, { apiCall, invalidResponse }) {
  const result = await apiCall(`/api/venue-snapshot?path=${encodeURIComponent(path)}${after ? `&after=${encodeURIComponent(after)}` : ""}`, {
    signal, expectedAccountId: accountId, silent: true, context: "Loading venue details",
  });
  const snapshot = normalizePublicVenueSnapshot(result, { path, identity, after });
  if (!snapshot) throw invalidResponse();
  return snapshot;
}
