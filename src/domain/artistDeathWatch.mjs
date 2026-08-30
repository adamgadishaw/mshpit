const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const WIKIDATA_ID = /^Q[1-9][0-9]*$/u;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;

export const ARTIST_DEATH_CANDIDATE_STATUSES = Object.freeze([
  "pending",
  "dismissed",
  "memorialized",
]);

export const ARTIST_DEATH_WATCH_BATCH_SIZE = 40;
export const ARTIST_DEATH_WATCH_MAX_CONFIRMATIONS = 5;
export const ARTIST_DEATH_WATCH_INTERVAL_MS = 60 * 60 * 1000;

export function canonicalArtistMbid(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return MBID.test(normalized) ? normalized : null;
}

export function canonicalWikidataId(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return WIKIDATA_ID.test(normalized) ? normalized : null;
}

export function canonicalDeathDate(value, { at = Date.now() } = {}) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  const match = ISO_DATE.exec(normalized);
  if (!match || Number(match[1]) < 1000) return null;
  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) return null;
  const timestamp = Number(at);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new TypeError("Death watch requires a valid timestamp");
  return normalized <= new Date(timestamp).toISOString().slice(0, 10) ? normalized : null;
}

export function parseDeathCandidateReview(value) {
  const status = typeof value === "string" ? value.trim().toLowerCase() : "";
  return status === "pending" || status === "dismissed" ? status : null;
}

export function artistDeathEvidenceUrls({ artistMbid, wikidataId } = {}) {
  const mbid = canonicalArtistMbid(artistMbid);
  const qid = canonicalWikidataId(wikidataId);
  if (!mbid || !qid) return null;
  return Object.freeze([
    Object.freeze({ provider: "Wikidata", url: `https://www.wikidata.org/wiki/${qid}` }),
    Object.freeze({ provider: "MusicBrainz", url: `https://musicbrainz.org/artist/${mbid}` }),
  ]);
}

export function projectArtistDeathCandidate(row) {
  const artistMbid = canonicalArtistMbid(row?.artist_mbid ?? row?.artistMbid);
  const wikidataId = canonicalWikidataId(row?.wikidata_id ?? row?.wikidataId);
  const deathDate = canonicalDeathDate(row?.death_date ?? row?.deathDate, {
    at: Math.max(Date.now(), Number(row?.last_confirmed_at ?? row?.lastConfirmedAt) || 0),
  });
  const artistKey = typeof (row?.artist_key ?? row?.artistKey) === "string"
    ? String(row.artist_key ?? row.artistKey).trim() : "";
  const artistName = typeof (row?.artist_name ?? row?.artistName) === "string"
    ? String(row.artist_name ?? row.artistName).trim() : "";
  const status = String(row?.status || "").trim().toLowerCase();
  const evidence = artistDeathEvidenceUrls({ artistMbid, wikidataId });
  if (!artistKey || !artistName || !artistMbid || !wikidataId || !deathDate
    || !ARTIST_DEATH_CANDIDATE_STATUSES.includes(status) || !evidence) return null;
  const integer = (value) => Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
  const firstDetectedAt = integer(row?.first_detected_at ?? row?.firstDetectedAt);
  const lastConfirmedAt = integer(row?.last_confirmed_at ?? row?.lastConfirmedAt);
  const reviewedAt = integer(row?.reviewed_at ?? row?.reviewedAt);
  if (firstDetectedAt == null || lastConfirmedAt == null) return null;
  return Object.freeze({
    artistKey,
    artistName,
    artistMbid,
    wikidataId,
    deathDate,
    status,
    firstDetectedAt,
    lastConfirmedAt,
    reviewedAt,
    evidence,
  });
}

export function projectArtistDeathWatchSettings(row) {
  if (!row) return null;
  const timestamp = (value) => Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
  return Object.freeze({
    enabled: Number(row.enabled) === 1,
    lastScanAt: timestamp(row.last_scan_at ?? row.lastScanAt),
    lastSuccessAt: timestamp(row.last_success_at ?? row.lastSuccessAt),
    nextScanAt: timestamp(row.next_scan_at ?? row.nextScanAt),
    lastErrorCode: typeof (row.last_error_code ?? row.lastErrorCode) === "string"
      ? String(row.last_error_code ?? row.lastErrorCode) : null,
  });
}
