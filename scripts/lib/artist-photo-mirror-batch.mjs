const MUSICBRAINZ_ARTIST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

export function normalizedArtistPhotoKey(value) {
  const key = typeof value === "string"
    ? value.normalize("NFKC").trim().toLocaleLowerCase("en").replace(/\s+/gu, " ")
    : "";
  return key && key.length <= 200 && !/[\u0000-\u001f\u007f]/u.test(key) ? key : null;
}

export function parseArtistPhotoMirrorArgs(args = []) {
  if (!Array.isArray(args) || args.length > 20) throw new Error("Artist-photo mirror arguments are invalid.");
  let artist = null;
  let dryRun = false;
  for (const raw of args) {
    if (raw === "--dry-run") {
      if (dryRun) throw new Error("--dry-run may be supplied only once.");
      dryRun = true;
      continue;
    }
    if (typeof raw === "string" && raw.startsWith("--artist=")) {
      if (artist) throw new Error("--artist may be supplied only once.");
      artist = normalizedArtistPhotoKey(raw.slice("--artist=".length));
      if (!artist) throw new Error("--artist must contain one exact artist key.");
      continue;
    }
    throw new Error(`Unknown artist-photo mirror argument: ${String(raw)}`);
  }
  return Object.freeze({ artist, dryRun });
}

function verifiedSourceRow(key, value) {
  const row = record(value);
  if (!row || normalizedArtistPhotoKey(row.artistKey) !== key || !record(row.photo)) {
    throw new Error(`Artist-photo source row is invalid: ${key}`);
  }
  const mbid = row.mbid == null || row.mbid === "" ? null
    : typeof row.mbid === "string" ? row.mbid.trim().toLowerCase() : "";
  if (mbid && !MUSICBRAINZ_ARTIST_ID.test(mbid)) {
    throw new Error(`Artist-photo source MBID is invalid: ${key}`);
  }
  return Object.freeze({
    key,
    row: Object.freeze({ artistKey: key, mbid, photo: row.photo }),
  });
}

export function selectArtistPhotoMirrorRows(source, { artist = null } = {}) {
  const catalog = record(source);
  if (!catalog) throw new Error("Artist-photo source catalog must be a JSON object.");
  const selectedArtist = artist == null ? null : normalizedArtistPhotoKey(artist);
  if (artist != null && !selectedArtist) throw new Error("Artist selector is invalid.");
  const rows = Object.entries(catalog)
    .map(([rawKey, value]) => {
      const key = normalizedArtistPhotoKey(rawKey);
      if (!key || key !== rawKey) throw new Error(`Artist-photo source key is not canonical: ${rawKey}`);
      return verifiedSourceRow(key, value);
    })
    .sort((left, right) => left.key.localeCompare(right.key, "en"));
  if (!selectedArtist) return rows;
  const exact = rows.find((entry) => entry.key === selectedArtist);
  if (!exact) throw new Error(`Unknown artist-photo source key: ${selectedArtist}`);
  return [exact];
}

export function mergeSuccessfulArtistPhotoMirrors(existing, successful = [], {
  authoritativeKeys = null,
} = {}) {
  const current = record(existing);
  if (!current) throw new Error("Verified artist-photo catalog must be a JSON object.");
  if (!Array.isArray(successful)) throw new Error("Successful artist-photo mirrors must be an array.");
  const allowed = authoritativeKeys == null ? null : new Set(authoritativeKeys.map((value) => {
    const key = normalizedArtistPhotoKey(value);
    if (!key || key !== value) throw new Error("Authoritative artist-photo keys must be canonical.");
    return key;
  }));
  const next = Object.fromEntries(Object.entries(current).filter(([key]) => !allowed || allowed.has(key)));
  for (const result of successful) {
    const key = normalizedArtistPhotoKey(result?.key);
    const artistKey = normalizedArtistPhotoKey(result?.artistKey);
    const photo = record(result?.photo);
    const mbid = result?.mbid == null || result.mbid === "" ? null
      : typeof result.mbid === "string" ? result.mbid.trim().toLowerCase() : "";
    if (!key || artistKey !== key || !photo || (mbid && !MUSICBRAINZ_ARTIST_ID.test(mbid))) {
      throw new Error("A successful artist-photo mirror result is invalid.");
    }
    next[key] = { artistKey: key, mbid, photo };
  }
  return next;
}
