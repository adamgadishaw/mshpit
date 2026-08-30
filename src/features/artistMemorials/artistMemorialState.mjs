import { projectLoadState } from "../../domain/loadState.mjs";
import { accountTargetScope } from "../../domain/screenScope.mjs";

export const EMPTY_ARTIST_MEMORIALS = Object.freeze([]);

function memorialIdentity(value) {
  return typeof value === "string" ? value.trim().normalize("NFKC").toLocaleLowerCase() : "";
}

export function artistMemorialScope({ accountId = null, artistKey = null } = {}) {
  return accountTargetScope(accountId, `artist-memorial:${memorialIdentity(artistKey)}`);
}

export function artistMemorialAdminScope({ accountId = null, sessionScope = null } = {}) {
  const staffScope = typeof sessionScope === "string" ? sessionScope : "";
  return accountTargetScope(accountId, `artist-memorials:admin:${staffScope}`);
}

export function projectArtistMemorial(resource, options = {}) {
  return projectLoadState(resource, artistMemorialScope(options), null);
}

// Public memorial reads are deliberately tri-state. `null` is meaningful only
// after a successful response (the artist is not memorialized); before that,
// loading and errors must not be mistaken for permission to show live-rating
// or upcoming-show actions. A known deceased payload remains authoritative
// during refreshes and refresh failures.
export function artistMemorialAvailability(resource, { artistKey = null, enabled = true } = {}) {
  if (resource?.data?.deceased === true) return "deceased";
  if (!enabled || !String(artistKey || "").trim()) return "unavailable";
  if (resource?.status === "ready" && resource.updatedAt != null) return "living";
  if (resource?.status === "error") return "unavailable";
  return "checking";
}

export function projectArtistMemorialAdmin(resource, options = {}) {
  return projectLoadState(resource, artistMemorialAdminScope(options), EMPTY_ARTIST_MEMORIALS);
}

export function mergeArtistMemorial(records, saved) {
  if (!saved?.artistKey) return Array.isArray(records) ? records : EMPTY_ARTIST_MEMORIALS;
  const current = Array.isArray(records) ? records : EMPTY_ARTIST_MEMORIALS;
  const next = current.filter((item) => item?.artistKey !== saved.artistKey);
  return [saved, ...next];
}
