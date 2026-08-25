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

export function projectArtistMemorialAdmin(resource, options = {}) {
  return projectLoadState(resource, artistMemorialAdminScope(options), EMPTY_ARTIST_MEMORIALS);
}

export function mergeArtistMemorial(records, saved) {
  if (!saved?.artistKey) return Array.isArray(records) ? records : EMPTY_ARTIST_MEMORIALS;
  const current = Array.isArray(records) ? records : EMPTY_ARTIST_MEMORIALS;
  const next = current.filter((item) => item?.artistKey !== saved.artistKey);
  return [saved, ...next];
}
