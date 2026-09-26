import { publicArtistCatalogSql } from "./artistCatalogVisibility.js";

// Discover's event slideshow only shows events with a picture, and few events
// carry credited artwork. An event bound to a catalogue artist may borrow the
// photo that artist already shows on its own page and on the Discover chart,
// with the same credit. Removed or unpublished profiles never lend one.
//
// Only Deezer images qualify. Spotify artwork must be shown uncropped next to
// a Spotify link (see db.publicArtist), and the slideshow crops to fill.
const MAX_KEYS = 500;

const deezerImageUrl = (value) => {
  if (typeof value !== "string" || value.length > 2000) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && /(^|\.)dzcdn\.net$/u.test(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
};

export function createTourDateArtistPhotoReader(database) {
  const statement = database.prepare(`SELECT a.norm,a.photo,
      CASE WHEN json_valid(a.data) THEN json_extract(a.data,'$.photoCredit') END AS credit
    FROM artists a
    WHERE a.norm IN (SELECT value FROM json_each(?)) AND a.photo IS NOT NULL
      AND ${publicArtistCatalogSql("a")}
      AND NOT EXISTS (SELECT 1 FROM artist_profiles hidden_profile
        WHERE hidden_profile.artist_key=a.norm AND hidden_profile.removed=1)`);

  // Adds `artistPhoto: { uri, credit }` to projected tour-date rows whose
  // public artistKey has a credited catalogue photo.
  return function withArtistPhotos(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const keys = [...new Set(list.map((row) => row?.artistKey).filter((key) => typeof key === "string" && key))].slice(0, MAX_KEYS);
    if (!keys.length) return list;
    const photos = new Map();
    for (const row of statement.all(JSON.stringify(keys))) {
      const uri = deezerImageUrl(row.photo);
      const credit = typeof row.credit === "string" ? row.credit.trim() : "";
      if (uri && credit === "Deezer") photos.set(row.norm, Object.freeze({ uri, credit }));
    }
    return list.map((row) => photos.has(row?.artistKey) ? { ...row, artistPhoto: photos.get(row.artistKey) } : row);
  };
}
