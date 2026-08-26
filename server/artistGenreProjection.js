import { projectArtistGenre } from "../src/domain/genre.mjs";

// Read only the bounded provenance fields needed to classify a genre. Artist
// metadata also contains photos, tracks and albums; pulling that entire blob
// through recommendation or analytics queries made a small label expensive.
export const ARTIST_GENRE_SQL_COLUMNS = `
  a.genre AS stored_genre,
  CASE WHEN json_valid(a.data) THEN substr(CAST(json_extract(a.data,'$.deezerId') AS TEXT),1,32) END AS genre_deezer_id,
  CASE WHEN json_valid(a.data) THEN substr(CAST(json_extract(a.data,'$.genreHint') AS TEXT),1,80) END AS genre_hint,
  CASE WHEN json_valid(a.data) THEN substr(CAST(json_extract(a.data,'$.genreClaims') AS TEXT),1,4096) END AS genre_claims,
  CASE WHEN json_valid(a.data) THEN substr(CAST(json_extract(a.data,'$.genreRecord') AS TEXT),1,1024) END AS genre_record,
  CASE WHEN json_valid(a.data) THEN substr(CAST(json_extract(a.data,'$.genreEvidence') AS TEXT),1,4096) END AS genre_evidence
`;

function jsonValue(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string" || !value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

export function projectArtistGenreColumns(row = {}) {
  const data = {};
  if (row.genre_deezer_id) data.deezerId = row.genre_deezer_id;
  if (row.genre_hint) data.genreHint = row.genre_hint;
  const claims = jsonValue(row.genre_claims);
  if (Array.isArray(claims)) data.genreClaims = claims;
  const record = jsonValue(row.genre_record);
  if (record && !Array.isArray(record)) data.genreRecord = record;
  const evidence = jsonValue(row.genre_evidence);
  if (evidence && !Array.isArray(evidence)) data.genreEvidence = evidence;
  return projectArtistGenre(data, row.stored_genre).genre;
}
