import { backgroundJobEnabled } from "../../backgroundJobs.js";
import { readCatalogKnowledgeControl } from "../../catalogKnowledgeControl.js";
import { discoverArtistPriorityKeys } from "../../discoverArtistPriority.js";
import { privateErrorLabel } from "../../errors.js";
import { startPeriodicJob } from "../../periodicJobScheduler.js";
import { spotifyArtistPhotoConfigured } from "../../spotifyArtistPhotos.js";

// Artist photos from Deezer (keyless), credited "Deezer", for when Spotify is
// not configured. Discover's artists go first, then artists touring soon, then
// popular acts: those pages are what new visitors see.
//
// A photo is taken only from an exact-name Deezer match with an established
// audience, and never Deezer's blank placeholder. The write is compare and
// set: it never replaces an existing photo, an owner's avatar, or a hidden
// profile, and every artist looked at is marked so a miss is not retried for
// two weeks.

const MINUTE = 60_000;
const RECHECK_MS = 14 * 24 * 60 * 60 * 1000;
const MIN_FANS = 1000;

const normalName = (value) => String(value || "").normalize("NFKC").trim().toLowerCase().replace(/\s+/gu, " ");
const parse = (value) => { try { const data = JSON.parse(value || "{}"); return data && typeof data === "object" && !Array.isArray(data) ? data : {}; } catch { return null; } };

// Deezer returns a generic silhouette for artists without a picture; its URL
// has an empty image hash ("/images/artist//").
export function usableDeezerPicture(url) {
  const value = String(url || "");
  return /^https:\/\/(?:e-)?cdns?-images\.dzcdn\.net\/images\/artist\/[0-9a-f]{32}\/\d+x\d+-[\w-]+\.jpg$/u.test(value) ? value : null;
}

// Deezer often has several exact namesakes ("Drake" has three). Take the one
// with the most fans only when it clearly dominates the rest and has an
// established audience; otherwise the name alone cannot tell them apart.
export function dominantNamesake(candidates, name) {
  const exact = (Array.isArray(candidates) ? candidates : [])
    .filter((artist) => normalName(artist?.name) === normalName(name))
    .sort((a, b) => (Number(b.nb_fan) || 0) - (Number(a.nb_fan) || 0));
  const [top, next] = exact;
  const fans = Number(top?.nb_fan) || 0;
  if (!top || fans < MIN_FANS) return null;
  return !next || fans >= 20 * Math.max(1, Number(next.nb_fan) || 0) ? top : null;
}

const eligibleSql = `a.photo IS NULL AND COALESCE(a.source,'')<>'artist-created'
  AND NOT EXISTS (SELECT 1 FROM artist_profiles ap WHERE ap.artist_key=a.norm AND (ap.removed=1 OR NULLIF(TRIM(ap.avatar_uri),'') IS NOT NULL))
  AND (a.data IS NULL OR json_valid(a.data)=0 OR COALESCE(CAST(json_extract(a.data,'$.deezerPhotoCheckedAt') AS INTEGER),0)<@before)`;

export function nextArtistsForDeezerPhoto(database, { at = Date.now(), limit = 20 } = {}) {
  const params = { before: at - RECHECK_MS, from: new Date(at).toISOString().slice(0, 10), to: new Date(at + 30 * 86_400_000).toISOString().slice(0, 10) };
  const picked = [];
  const seen = new Set();
  const take = (rows) => {
    for (const row of rows) {
      if (picked.length >= limit) return;
      if (!seen.has(row.norm)) { seen.add(row.norm); picked.push(row); }
    }
  };
  const columns = "a.norm,a.name,a.data,a.updated_at";
  const priority = discoverArtistPriorityKeys(database, at);
  if (priority.length) {
    take(database.prepare(`SELECT ${columns} FROM artists a WHERE a.norm IN (SELECT value FROM json_each(@keys)) AND ${eligibleSql} LIMIT @limit`)
      .all({ before: params.before, keys: JSON.stringify(priority), limit }));
  }
  if (picked.length < limit) {
    take(database.prepare(`SELECT ${columns} FROM artists a WHERE a.norm IN (
        SELECT DISTINCT artist_key FROM tour_dates WHERE artist_key IS NOT NULL AND date>=@from AND date<=@to)
      AND ${eligibleSql} ORDER BY COALESCE(a.popularity,0) DESC LIMIT @limit`).all({ ...params, limit }));
  }
  if (picked.length < limit) {
    take(database.prepare(`SELECT ${columns} FROM artists a WHERE COALESCE(a.popularity,0)>=60 AND ${eligibleSql}
      ORDER BY a.popularity DESC LIMIT @limit`).all({ before: params.before, limit }));
  }
  return picked;
}

function markChecked(database, row, data, at, fields = {}) {
  const next = { ...data, ...fields, deezerPhotoCheckedAt: at };
  const photo = fields.photo || null;
  return database.prepare(`UPDATE artists SET ${photo ? "photo=@photo," : ""}data=@data,updated_at=@at
    WHERE norm=@norm AND name=@name AND data IS @before AND updated_at IS @updated AND photo IS NULL
    AND NOT EXISTS (SELECT 1 FROM artist_profiles ap WHERE ap.artist_key=artists.norm AND (ap.removed=1 OR NULLIF(TRIM(ap.avatar_uri),'') IS NOT NULL))`)
    .run({ ...(photo ? { photo } : {}), data: JSON.stringify(next), at, norm: row.norm, name: row.name, before: row.data, updated: row.updated_at }).changes === 1;
}

// One pass: look each artist up once and keep the photo only on a safe match.
export async function runDeezerPhotoPass(database, { fetchJson, at = Date.now(), limit = 20, signal } = {}) {
  const outcome = { checked: 0, filled: 0, noMatch: 0 };
  for (const row of nextArtistsForDeezerPhoto(database, { at, limit })) {
    if (signal?.aborted) break;
    const data = parse(row.data);
    if (!data) continue;
    const found = await fetchJson(`https://api.deezer.com/search/artist?q=${encodeURIComponent(row.name)}&limit=5`, { signal });
    const match = dominantNamesake(found?.data, row.name);
    const picture = match ? usableDeezerPicture(match.picture_xl || match.picture_big) : null;
    outcome.checked += 1;
    if (picture) {
      if (markChecked(database, row, data, at, { photo: picture, photoCredit: "Deezer", photoSource: "deezer", deezerId: data.deezerId || match.id })) outcome.filled += 1;
    } else {
      markChecked(database, row, data, at);
      outcome.noMatch += 1;
    }
  }
  return outcome;
}

export function startDeezerArtistPhotoScheduler({ database, env = process.env, now = Date.now, fetchJson }) {
  // The Spotify pipeline owns photos whenever it is configured.
  if (spotifyArtistPhotoConfigured(env) || !backgroundJobEnabled(env, "ARTIST_PHOTO_DEEZER_ENABLED")) return null;
  return startPeriodicJob({
    initialDelayMs: 3 * MINUTE,
    intervalMs: 15 * MINUTE,
    run: async ({ signal }) => {
      if (readCatalogKnowledgeControl(database, { env, at: now() })?.mode === "paused") return true;
      const result = await runDeezerPhotoPass(database, { fetchJson, at: now(), signal });
      if (result.checked) console.log(`[artist-photos] deezer checked=${result.checked} filled=${result.filled} noMatch=${result.noMatch}`);
      return true;
    },
    report: (error) => console.error(`[artist-photos] deezer pass failed safely: ${privateErrorLabel(error)}`),
  });
}
