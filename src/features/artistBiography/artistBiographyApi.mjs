import { artistBiographyIdentity, projectArtistBiography, validateStaffArtistBiography } from "../../domain/artistBiography.mjs";

function requestContext(options, services) {
  if (typeof services?.apiCall !== "function") throw new TypeError("Artist-facts transport is unavailable");
  const accountId = typeof options?.accountId === "string" ? options.accountId.trim() : "";
  const artistKey = typeof options?.artistKey === "string" ? options.artistKey.trim().toLowerCase() : "";
  if (!accountId || !artistKey || artistKey.length > 200 || /[\u0000-\u001f\u007f]/u.test(artistKey)) {
    throw new TypeError("Artist facts require an authenticated account and an artist identity");
  }
  return { path: `/api/admin/artists/${encodeURIComponent(artistKey)}/biography`,
    options: { signal: options.signal, expectedAccountId: accountId, silent: true } };
}

function snapshot(payload) {
  if (typeof payload?.artistKey !== "string" || !payload.artistKey || !Number.isSafeInteger(payload.revision) || payload.revision < 0
    || !Object.prototype.hasOwnProperty.call(payload, "artistMbid") || payload.artistMbid !== artistBiographyIdentity(payload.artistMbid)) {
    throw new TypeError("The artist-facts response was invalid");
  }
  const facts = payload.facts == null ? null : projectArtistBiography({ biographyFacts: payload.facts });
  const pendingFacts = payload.pendingFacts == null ? null : projectArtistBiography({ biographyFacts: payload.pendingFacts });
  if ((payload.facts != null && !facts) || (payload.pendingFacts != null && !pendingFacts)) throw new TypeError("The artist-facts response was invalid");
  return { artistKey: payload.artistKey, artistMbid: payload.artistMbid, revision: payload.revision, facts,
    requiresReview: payload.requiresReview === true, pendingFacts,
    legacyYear: typeof payload.legacyYear === "string" ? payload.legacyYear.slice(0, 80) : null };
}

export async function fetchArtistBiography(options = {}, services = {}) {
  const request = requestContext(options, services);
  return snapshot(await services.apiCall(request.path, { ...request.options, context: "Loading artist facts" }));
}

export async function saveArtistBiography(options = {}, services = {}) {
  const request = requestContext(options, services);
  if (!Number.isSafeInteger(options.revision) || options.revision < 0) throw new TypeError("Reload the artist facts before saving");
  const facts = validateStaffArtistBiography(options.facts);
  if (!Object.prototype.hasOwnProperty.call(options, "artistMbid") || options.artistMbid !== artistBiographyIdentity(options.artistMbid)) throw new TypeError("Reload the artist identity before saving");
  return snapshot(await services.apiCall(request.path, { ...request.options, method: "PUT",
    body: { revision: options.revision, artistMbid: options.artistMbid, facts }, context: "Saving artist facts" }));
}
