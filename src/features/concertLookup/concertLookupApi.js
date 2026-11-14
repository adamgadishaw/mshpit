import { api } from "../../lib/api";

export async function readConcertMatches(query, { source, accountId, signal }) {
  const params = new URLSearchParams({ artist: query.artist, city: query.city, date: query.date, source });
  if (query.artistKey) params.set("artistKey", query.artistKey);
  return api(`/api/concerts/lookup?${params}`, { signal, expectedAccountId: accountId, silent: true, context: "Finding your concert" });
}
