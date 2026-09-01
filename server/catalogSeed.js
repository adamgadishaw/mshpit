// Catalog seeder — grow the DB artist roster toward ~10k across all genres,
// keyless. Shared by the CLI (scripts/seed-db-artists.mjs) and the admin console
// (POST /api/admin/catalog/seed, which runs it in-process as a background job).
//
// Roster-only by design: MusicBrainz tag crawl fills name/genre/mbid/country;
// Deezer fills fan-count popularity + photo + the rank_score that orders search.
// Songs/albums stay on-demand (the artist page pulls its Deezer discography with
// previews when opened), so every seeded artist is playable without a song scrape.
import { randomUUID } from "node:crypto";
import { artistStmts, artistRow, normName, db } from "./db.js";
import { findDeezerArtist, providerJson, ProviderError } from "./musicProviders.js";
import {
  deezerEnrichmentGenreFields, deezerReleaseGenreConsensus, needsDeezerGenreRevalidation,
} from "./deezerGenre.js";
import { genreFieldsForClaim, resolveGenre, storedClaims } from "../src/domain/genre.mjs";
import { privateErrorLabel } from "./errors.js";

// Enrichment used to do `row.genre || e.genre`, which let a stale crawl-bucket
// label outrank real provider evidence: Deezer knew Justin Bieber was pop, but
// "Metal" from the tag crawl kept winning. Resolving through the provenance
// hierarchy instead means evidence beats a hint, a staff decision beats both,
// and a provider returning nothing leaves the record alone.

export function crawlerGenreFields(genre) {
  const fields = genreFieldsForClaim({}, null, genre, "tag_hint");
  return {
    ...fields,
    // Keep the discovery bucket in the claim history and review hint only. The
    // typed column remains null until provider/staff evidence exists.
    genre: null,
    genreHint: fields.genre || null,
  };
}

const PAGE = 100; // MusicBrainz hard max per request
const UA = "PitConcertApp/1.0 (https://mshpit.com)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const popFromFans = (n) => Math.max(1, Math.min(100, Math.round(Math.log10((n || 0) + 1) * 12.5)));
export const PHOTO_FILL_LIMIT = 40;

// Broad genre coverage: each tag pulls real artists from MusicBrainz (keyless).
export const GENRE_TAGS = [
  ["punk", "Punk"], ["pop punk", "Pop Punk"], ["hardcore", "Hardcore"], ["hardcore punk", "Hardcore"],
  ["metalcore", "Metalcore"], ["indie rock", "Indie"], ["indie pop", "Indie"], ["shoegaze", "Shoegaze"],
  ["dream pop", "Dream Pop"], ["metal", "Metal"], ["death metal", "Metal"], ["black metal", "Metal"],
  ["doom metal", "Metal"], ["thrash metal", "Metal"], ["nu metal", "Metal"], ["alternative metal", "Metal"],
  ["progressive metal", "Metal"], ["electronic", "Electronic"], ["techno", "Techno"], ["house", "House"],
  ["deep house", "House"], ["drum and bass", "DnB"], ["dubstep", "Dubstep"], ["trance", "Trance"],
  ["edm", "EDM"], ["ambient", "Ambient"], ["idm", "Electronic"], ["hip hop", "Hip-Hop"], ["rap", "Hip-Hop"],
  ["trap", "Trap"], ["grime", "Grime"], ["r&b", "R&B"], ["contemporary r&b", "R&B"], ["soul", "Soul"],
  ["funk", "Funk"], ["disco", "Disco"], ["jazz", "Jazz"], ["bossa nova", "Jazz"], ["blues", "Blues"],
  ["pop", "Pop"], ["synthpop", "Synthpop"], ["new wave", "New Wave"], ["k-pop", "K-Pop"], ["j-pop", "J-Pop"],
  ["rock", "Rock"], ["classic rock", "Rock"], ["hard rock", "Rock"], ["garage rock", "Garage Rock"],
  ["grunge", "Grunge"], ["progressive rock", "Prog Rock"], ["psychedelic rock", "Psych Rock"],
  ["post-rock", "Post-Rock"], ["math rock", "Math Rock"], ["noise rock", "Noise Rock"], ["emo", "Emo"],
  ["post-punk", "Post-Punk"], ["dance-punk", "Dance-Punk"], ["alternative rock", "Alt Rock"],
  ["experimental", "Experimental"], ["folk", "Folk"], ["indie folk", "Folk"], ["americana", "Americana"],
  ["country", "Country"], ["bluegrass", "Bluegrass"], ["singer-songwriter", "Singer-Songwriter"],
  ["reggae", "Reggae"], ["dancehall", "Dancehall"], ["ska", "Ska"], ["afrobeat", "Afrobeat"],
  ["afrobeats", "Afrobeats"], ["latin", "Latin"], ["reggaeton", "Reggaeton"], ["salsa", "Latin"],
  ["classical", "Classical"], ["gospel", "Gospel"], ["world", "World"],
];

async function mbTag(tag, offset) {
  const url = `https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(`tag:"${tag}"`)}&fmt=json&limit=${PAGE}&offset=${offset}`;
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new ProviderError("MusicBrainz", r.status, `MusicBrainz returned ${r.status}.`, { code: r.status === 429 ? "rate_limited" : "http_error" });
      const d = await r.json();
      const raw = Array.isArray(d.artists) ? d.artists : [];
      return {
        items: raw
          .filter((x) => x.name && (x.type === "Group" || x.type === "Person"))
          .map((x) => ({ name: x.name, mbid: x.id, beginYear: x["life-span"]?.begin?.slice(0, 4) || null, country: x.area?.name || null })),
        rawCount: raw.length,
        total: Number(d.count ?? d["artist-count"]) || null,
      };
    } catch (error) {
      lastError = error;
      if (attempt < 2) await sleep(1000 * (attempt + 1));
    }
  }
  throw lastError || new ProviderError("MusicBrainz", 502, "MusicBrainz could not be reached.");
}

// Full Deezer enrichment for one artist, with an EXACT-name-preferred match so we
// never attach a same-named / tribute act's photo or songs (the cause of "wrong
// photo / wrong songs" on profiles). Returns photo, popularity, followers, the top
// tracks that power Discover's "top song", and a genre only when several
// distinct releases agree. A compilation or collaboration cannot decide it.
export async function deezerEnrich(name, { findArtist = findDeezerArtist } = {}) {
  const row = artistStmts.byNorm.get(normName(name));
  let existing = {};
  try { existing = JSON.parse(row?.data || "{}"); } catch { /* Corrupt legacy metadata fails closed to an empty provider hint. */ }
  const match = await findArtist(name, { hintId: existing.deezerId || null });
  const dzA = match?.artist;
  if (!dzA) return null;
  const top = await providerJson("Deezer", `https://api.deezer.com/artist/${dzA.id}/top?limit=25`);
  await sleep(60);
  const topTracks = (top?.data || []).map((t) => ({ id: t.id || null, title: t.title, album: t.album?.title || null, duration: t.duration || 0 }));
  const albumIds = [...new Set((top?.data || []).map((track) => track?.album?.id).filter(Boolean))].slice(0, 5);
  const releaseGenres = [];
  for (const albumId of albumIds) {
    try {
      const album = await providerJson("Deezer", `https://api.deezer.com/album/${albumId}`);
      releaseGenres.push(album?.genres?.data?.[0]?.name || null);
    } catch {
      // A removed/rate-limited album is one missing sample, not a failed artist.
    }
    await sleep(25);
  }
  const genreEvidence = deezerReleaseGenreConsensus(releaseGenres);
  const genre = genreEvidence?.genre || null;
  return {
    deezerId: dzA.id,
    identityConfidence: match.confidence,
    photo: dzA.picture_xl || dzA.picture_big || null,
    popularity: popFromFans(dzA.nb_fan),
    followers: dzA.nb_fan,
    topTracks,
    genre,
    genreEvidence,
  };
}

// Per-tag crawl cursor so re-runs never re-fetch a page they already finished.
const cursorGet = db.prepare("SELECT next_off, exhausted FROM seed_cursor WHERE tag = ?");
const cursorSet = db.prepare(`INSERT INTO seed_cursor (tag, next_off, exhausted, updated_at) VALUES (?,?,?,?)
  ON CONFLICT(tag) DO UPDATE SET next_off = excluded.next_off, exhausted = excluded.exhausted, updated_at = excluded.updated_at`);

// Older builds marked a tag exhausted after filtering a raw page down to
// Group/Person results. Reopen those cursors once; the corrected crawl below
// closes a tag only from MusicBrainz's unfiltered count/page length.
function reopenLegacyCursors() {
  const marker = "repair-musicbrainz-cursors-v1";
  if (db.prepare("SELECT 1 FROM app_meta WHERE key=?").get(marker)) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    if (!db.prepare("SELECT 1 FROM app_meta WHERE key=?").get(marker)) {
      db.prepare("UPDATE seed_cursor SET exhausted=0 WHERE exhausted=1").run();
      db.prepare("INSERT OR IGNORE INTO app_meta (key,value) VALUES (?,?)").run(marker, String(Date.now()));
    }
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* Preserve the migration error that caused the rollback. */ }
    throw error;
  }
}
reopenLegacyCursors();

// Phase 1: crawl MusicBrainz tags → upsert bare rows. Additive (never clobbers an
// existing artist) AND resumable (skips exhausted tags, resumes each at its saved
// offset), so nothing is fetched or inserted twice across runs.
export async function crawlArtists({ target = 10000, perTag = 600, shouldStop = () => false, tick = () => {} } = {}) {
  let added = 0, pages = 0, openTags = 0;
  outer: for (const [tag, genre] of GENRE_TAGS) {
    const cur = cursorGet.get(tag);
    if (cur?.exhausted) continue; // whole tag already crawled — skip the network entirely
    openTags++;
    for (let offset = cur?.next_off || 0; offset < perTag; offset += PAGE) {
      if (shouldStop() || artistStmts.count.get().c >= target) break outer;
      const page = await mbTag(tag, offset);
      const list = page.items;
      pages++;
      await sleep(1100); // MusicBrainz ~1 req/s
      for (const x of list) {
        const norm = normName(x.name);
        if (artistStmts.byNorm.get(norm)) continue; // additive: never re-add
        // Search tags are useful for discovery, but not authoritative enough to
        // publish as the artist's primary genre. Enrichment can verify it later.
        artistStmts.upsert.run(artistRow(norm, { name: x.name, ...crawlerGenreFields(genre), mbid: x.mbid, country: x.country, beginYear: x.beginYear }, "musicbrainz"));
        added++;
      }
      const done = page.total != null ? offset + PAGE >= page.total : page.rawCount < PAGE;
      cursorSet.run(tag, offset + PAGE, done ? 1 : 0, Date.now());
      tick({ phase: "crawl", added, total: artistStmts.count.get().c, note: tag });
      if (done) break;
    }
  }
  return { added, total: artistStmts.count.get().c, pages, openTags, reachedTarget: artistStmts.count.get().c >= target };
}

// Phase 2: rank the artists still missing popularity via Deezer, filling photo,
// popularity, top tracks (so Discover shows a real "top song") and a genre when
// they don't have one. Resumable.
export async function enrichThin({ shouldStop = () => false, tick = () => {} } = {}) {
  const rows = db.prepare("SELECT norm,name,genre,mbid,country,formed,data FROM artists WHERE popularity IS NULL").all();
  let ranked = 0, done = 0;
  for (const row of rows) {
    if (shouldStop()) break;
    const e = await deezerEnrich(row.name);
    await sleep(80); // gentle on the keyless API
    if (e) {
      let data = {}; try { data = JSON.parse(row.data || "{}"); } catch { /* Enrichment replaces no fields from corrupt metadata. */ }
      const merged = {
        ...data, name: row.name, ...deezerEnrichmentGenreFields(data, row.genre, e),
        mbid: row.mbid, country: row.country, beginYear: row.formed,
        popularity: e.popularity, followers: e.followers, deezerId: e.deezerId,
        photo: data.photo || e.photo, photoCredit: data.photo ? data.photoCredit : (e.photo ? "Deezer" : null),
        topTracks: (data.topTracks && data.topTracks.length) ? data.topTracks : e.topTracks,
      };
      artistStmts.upsert.run(artistRow(row.norm, merged, "deezer"));
      ranked++;
    }
    if (++done % 25 === 0) tick({ phase: "enrich", ranked, done, of: rows.length });
  }
  tick({ phase: "enrich", ranked, done, of: rows.length });
  return ranked;
}

// Backfill pass: ranked artists whose data blob has no top tracks yet (blank "top
// song" on Discover) get their Deezer top tracks + a genre if missing. Most-popular
// first, resumable (each run only touches rows still lacking a filled topTracks).
export async function enrichSongs({ shouldStop = () => false, tick = () => {} } = {}) {
  const rows = db.prepare(`SELECT norm,name,genre,data FROM artists
    WHERE popularity IS NOT NULL AND (data IS NULL OR data NOT LIKE '%"topTracks":[{%')
    ORDER BY popularity DESC`).all();
  let filled = 0, done = 0;
  for (const row of rows) {
    if (shouldStop()) break;
    const e = await deezerEnrich(row.name);
    await sleep(90);
    if (e && e.topTracks.length) {
      let data = {}; try { data = JSON.parse(row.data || "{}"); } catch { /* Song refresh replaces no fields from corrupt metadata. */ }
      const merged = {
        ...data, name: row.name, ...deezerEnrichmentGenreFields(data, row.genre, e),
        topTracks: e.topTracks, photo: data.photo || e.photo, followers: data.followers ?? e.followers, deezerId: e.deezerId || data.deezerId,
      };
      artistStmts.upsert.run(artistRow(row.norm, merged, "deezer"));
      filled++;
    }
    if (++done % 25 === 0) tick({ phase: "songs", ranked: filled, done, of: rows.length });
  }
  tick({ phase: "songs", ranked: filled, done, of: rows.length });
  return filled;
}

// Missing-photo repair is deliberately separate from the catalog crawl and the
// songs/genre refresh. The old moderation action sent as many as 40 artists
// through one browser request, so its sequential provider work routinely outlived
// the 30-second request deadline. This cursor makes the same useful repair a
// bounded background pass that survives restarts and never repeats artists that
// were already checked in the current catalog cycle.
const PHOTO_FILL_CURSOR_KEY = "catalog_photo_fill_cursor_v1";
const photoFillCursorGet = db.prepare("SELECT value FROM app_meta WHERE key=?");
const photoFillCursorSet = db.prepare(`INSERT INTO app_meta (key,value) VALUES (?,?)
  ON CONFLICT(key) DO UPDATE SET value=excluded.value`);
const photoFillPendingCount = db.prepare("SELECT COUNT(*) c FROM artists WHERE photo IS NULL");
const photoFillAfterCursor = db.prepare(`SELECT norm,name,genre,photo,mbid,country,formed,popularity,data,source
  FROM artists WHERE photo IS NULL AND norm > ? ORDER BY norm LIMIT ?`);
const photoFillFromStart = db.prepare(`SELECT norm,name,genre,photo,mbid,country,formed,popularity,data,source
  FROM artists WHERE photo IS NULL ORDER BY norm LIMIT ?`);
const photoFillThroughCursor = db.prepare(`SELECT norm,name,genre,photo,mbid,country,formed,popularity,data,source
  FROM artists WHERE photo IS NULL AND norm <= ? ORDER BY norm LIMIT ?`);

function loadPhotoFillBatch(cursor, limit) {
  const bounded = Math.max(1, Math.min(PHOTO_FILL_LIMIT, Number(limit) || PHOTO_FILL_LIMIT));
  if (!cursor) {
    return {
      rows: photoFillFromStart.all(bounded),
      total: Number(photoFillPendingCount.get()?.c) || 0,
      wrapped: false,
    };
  }
  const after = photoFillAfterCursor.all(cursor, bounded);
  const remaining = bounded - after.length;
  const before = remaining > 0 ? photoFillThroughCursor.all(cursor, remaining) : [];
  return {
    rows: [...after, ...before],
    total: Number(photoFillPendingCount.get()?.c) || 0,
    wrapped: before.length > 0,
  };
}

export function mergePhotoFillData(row, data, enriched) {
  if (!enriched?.deezerId) return null;
  return {
    ...data,
    name: row.name,
    ...deezerEnrichmentGenreFields(data, row.genre, enriched),
    mbid: row.mbid || data.mbid || null,
    country: row.country || data.country || null,
    beginYear: row.formed || data.beginYear || data.formed || null,
    popularity: row.popularity ?? data.popularity ?? enriched.popularity ?? null,
    followers: data.followers ?? enriched.followers ?? null,
    deezerId: enriched.deezerId,
    photo: data.photo || row.photo || enriched.photo || null,
    photoCredit: data.photo || row.photo
      ? data.photoCredit || null
      : enriched.photo
        ? "Deezer"
        : data.photoCredit || null,
    topTracks: Array.isArray(data.topTracks) && data.topTracks.length
      ? data.topTracks
      : enriched.topTracks || [],
  };
}

function persistPhotoFill(row, enriched) {
  let data = {};
  try { data = JSON.parse(row.data || "{}"); } catch { /* Corrupt metadata is repaired from typed/provider fields. */ }
  const merged = mergePhotoFillData(row, data, enriched);
  if (!merged) return false;
  artistStmts.upsert.run(artistRow(row.norm, merged, row.source || "deezer"));
  return !!merged.photo;
}

function providerFailureCode(error) {
  if (error?.code === "rate_limited") return "CATALOG_PHOTOS_RATE_LIMITED";
  return "CATALOG_PHOTOS_PROVIDER_UNAVAILABLE";
}

export async function fillMissingArtistPhotos({
  shouldStop = () => false,
  tick = () => {},
  limit = PHOTO_FILL_LIMIT,
  readCursor = () => photoFillCursorGet.get(PHOTO_FILL_CURSOR_KEY)?.value || "",
  writeCursor = (value) => photoFillCursorSet.run(PHOTO_FILL_CURSOR_KEY, value),
  loadBatch = loadPhotoFillBatch,
  enrichArtist = deezerEnrich,
  persistArtist = persistPhotoFill,
  pause = sleep,
} = {}) {
  const bounded = Math.max(1, Math.min(PHOTO_FILL_LIMIT, Number(limit) || PHOTO_FILL_LIMIT));
  const initialCursor = String(readCursor() || "");
  const batch = loadBatch(initialCursor, bounded) || {};
  const rows = Array.isArray(batch.rows) ? batch.rows.slice(0, bounded) : [];
  let attempted = 0;
  let filled = 0;
  let noMatch = 0;
  let lastAttempted = initialCursor;
  let providerFailure = null;

  for (const row of rows) {
    if (shouldStop()) break;
    let enriched;
    try {
      enriched = await enrichArtist(row.name);
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      providerFailure = {
        code: providerFailureCode(error),
        provider: String(error.provider || "provider"),
      };
      break;
    }

    const savedPhoto = enriched ? !!persistArtist(row, enriched) : false;
    attempted += 1;
    if (savedPhoto) filled += 1;
    else noMatch += 1;
    lastAttempted = row.norm;
    writeCursor(lastAttempted);
    tick({ phase: "photos", attempted, filled, noMatch, failed: 0, of: rows.length });
    await pause(80);
  }

  const stopped = shouldStop();
  tick({ phase: "photos", attempted, filled, noMatch, failed: providerFailure ? 1 : 0, of: rows.length });
  return {
    attempted,
    filled,
    noMatch,
    failed: providerFailure ? 1 : 0,
    providerFailure,
    stopped,
    cursor: lastAttempted,
    pendingAtStart: Number(batch.total) || rows.length,
    batchSize: rows.length,
    wrapped: !!batch.wrapped,
  };
}

// ---- In-process background job (admin console) ----
// `add` is a DELTA: grow the catalog BY this many artists (target = current + add).
// It is NOT guaranteed to add anything: once every genre tag has been crawled to
// the end of its results, a run legitimately adds zero and finishes as
// "exhausted" with CATALOG_CRAWL_EXHAUSTED. It must say so rather than report
// success, and it must not fall through into a mass re-enrichment of profiles
// that are already fine (that is what rewrote ~46k preview URLs on 2026-07-14).
const seedRunInsert = db.prepare(`INSERT INTO seed_runs
  (id,mode,status,start_total,target,added,enriched,error_code,note,started_at,finished_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
const seedRunUpdate = db.prepare(`UPDATE seed_runs SET status=?,added=?,enriched=?,error_code=?,note=?,finished_at=? WHERE id=?`);
db.prepare("UPDATE seed_runs SET status='interrupted',error_code='CATALOG_JOB_INTERRUPTED',finished_at=? WHERE status='running'").run(Date.now());

// Decide what a finished grow run ACTUALLY did. A run that crawled every genre to
// the end of its results and added nothing is not a success; reporting "done" is
// exactly what made the admin button look like it worked while doing nothing.
// Genre backfill. The crawl published its discovery bucket as the artist's
// genre, so most of the catalogue carries a hint rather than evidence and the
// projection (rightly) refuses to state it. This asks Deezer what the artist
// actually is and records it only when several distinct releases agree.
//
// Most-popular first, because that is what Discover surfaces, and resumable:
// each run only touches artists that still lack an evidence-backed genre, so it
// can be stopped and restarted without redoing work. Staff corrections are
// untouched, since release consensus never outranks `staff`.
const GENRE_BACKFILL_CURSOR_KEY = "catalog_genre_backfill_cursor_v2";

export function rotateRowsAfterCursor(rows, cursor) {
  if (!cursor || !rows.length) return rows;
  const index = rows.findIndex((row) => row.norm === cursor);
  return index < 0 ? rows : [...rows.slice(index + 1), ...rows.slice(0, index + 1)];
}

export function mergeGenreBackfillData(row, data, enriched) {
  if (!enriched?.deezerId) return null;
  const genreFields = deezerEnrichmentGenreFields(data, row.genre, enriched);
  if (!genreFields.genreClaims) return null;
  return {
    ...data,
    name: row.name,
    deezerId: enriched.deezerId,
    ...genreFields,
  };
}

export async function backfillGenres({ shouldStop = () => false, tick = () => {}, limit = 500 } = {}) {
  const orderedRows = db.prepare(`SELECT norm,name,genre,data,source FROM artists
    ORDER BY popularity IS NULL, popularity DESC, rank_score DESC, norm`).all();
  const cursor = db.prepare("SELECT value FROM app_meta WHERE key=?").get(GENRE_BACKFILL_CURSOR_KEY)?.value || "";
  const rows = rotateRowsAfterCursor(orderedRows, cursor);

  const pending = [];
  for (const row of rows) {
    let data = {};
    try { data = JSON.parse(row.data || "{}"); } catch { /* Corrupt rows remain eligible for provider repair. */ }
    const record = resolveGenre(storedClaims(data, row.genre));
    if (!record || !record.evidence || needsDeezerGenreRevalidation(data, row.genre)) {
      pending.push({ row, data });
    }
    if (pending.length >= limit) break;
  }

  let fixed = 0, done = 0, lastAttemptedNorm = "";
  for (const { row, data } of pending) {
    if (shouldStop()) break;
    let enriched = null;
    try { enriched = await deezerEnrich(row.name); } catch { enriched = null; }
    await sleep(90); // gentle on the keyless API
    lastAttemptedNorm = row.norm;
    const merged = mergeGenreBackfillData(row, data, enriched);
    if (merged) {
      artistStmts.upsert.run(artistRow(row.norm, merged, row.source || "deezer"));
      fixed++;
    }
    if (++done % 25 === 0) tick({ phase: "genres", fixed, done, of: pending.length });
  }
  tick({ phase: "genres", fixed, done, of: pending.length });
  if (lastAttemptedNorm) {
    db.prepare(`INSERT INTO app_meta (key,value) VALUES (?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
      .run(GENRE_BACKFILL_CURSOR_KEY, lastAttemptedNorm);
  }

  return { fixed, scanned: done, pending: pending.length };
}

export function growOutcome({ added, reachedTarget, stopRequested }) {
  if (stopRequested) return { phase: "stopped" };
  if (added === 0 && !reachedTarget) {
    return {
      phase: "exhausted",
      errorCode: "CATALOG_CRAWL_EXHAUSTED",
      note: "No new artists were returned at this crawl depth; existing profiles were left untouched.",
    };
  }
  return { phase: "done" };
}

// Enrichment must only run for artists this crawl actually added. A no-op grow
// that fell through into a full re-enrich is what rewrote ~46k expiring Deezer
// preview URLs on 2026-07-14 and made playback progressively worse.
export const shouldEnrichAfterCrawl = ({ enrich, added, stopRequested }) => !!enrich && added > 0 && !stopRequested;

export function catalogSeedRequestOptions(body = {}) {
  if (body?.mode === "refresh" || body?.mode === "photos") return { mode: body.mode };
  const add = Math.max(100, Math.min(20000, Number(body?.add) || 2000));
  return { add };
}

let state = { runId: null, running: false, stopRequested: false, mode: "grow", phase: "idle", add: 0, target: 0, startTotal: 0, added: 0, ranked: 0, total: 0, startedAt: 0, finishedAt: 0, error: null, errorCode: null, note: "" };

const reportDetachedSeedFailure = (error, runId) => {
  console.error(`[pit] catalog seed task failed outside its provider boundary cause=${privateErrorLabel(error)}`);
  if (state.runId !== runId) return;
  state.running = false;
  state.stopRequested = false;
  state.phase = "error";
  state.error = String(error?.message || error);
  state.errorCode = "CATALOG_JOB_FAILED";
  state.finishedAt = Date.now();
};

export function catalogSeedStatus() {
  return { ...state, total: artistStmts.count.get().c };
}

// Ask a running job to stop at the next page/artist boundary (finishes cleanly,
// keeps everything already seeded; the cursor means a later run resumes here).
export function stopCatalogSeed() {
  if (state.running) { state.stopRequested = true; state.note = "stopping"; }
  return catalogSeedStatus();
}

export async function refreshSongsAndGenres({
  shouldStop = () => false,
  songTick = () => {},
  genreTick = () => {},
  beforeGenres = () => {},
  enrichSongsImpl = enrichSongs,
  backfillGenresImpl = backfillGenres,
} = {}) {
  const songs = await enrichSongsImpl({ shouldStop, tick: songTick });
  if (shouldStop()) {
    return { songs, genres: { fixed: 0, scanned: 0, pending: 0 }, stopped: true };
  }
  beforeGenres();
  const genres = await backfillGenresImpl({
    shouldStop,
    tick: (progress) => genreTick({ ...progress, songs }),
  });
  return { songs, genres, stopped: shouldStop() };
}

export function startCatalogSeed({ add = 2000, perTag = null, enrich = false, mode = "grow" } = {}) {
  if (state.running) return { started: false, reason: "already-running", status: catalogSeedStatus() };
  const startTotal = artistStmts.count.get().c;
  const shouldStop = () => state.stopRequested;

  if (mode === "photos") {
    const runId = `seed_${randomUUID().slice(0, 12)}`;
    const pending = Number(photoFillPendingCount.get()?.c) || 0;
    const target = Math.min(PHOTO_FILL_LIMIT, pending);
    state = {
      runId, running: true, stopRequested: false, mode, phase: "photos",
      add: 0, target, startTotal, added: 0, ranked: 0, total: startTotal,
      attempted: 0, filled: 0, failed: 0, remaining: pending,
      startedAt: Date.now(), finishedAt: 0, error: null, errorCode: null,
      note: pending ? `Checking up to ${target} profiles missing photos.` : "No artist profiles are missing photos.",
    };
    seedRunInsert.run(runId, mode, "running", startTotal, target, 0, 0, null, state.note, state.startedAt, null);
    void (async () => {
      try {
        const result = await fillMissingArtistPhotos({
          shouldStop,
          tick: ({ attempted, filled, failed, of }) => {
            state.added = attempted;
            state.ranked = filled;
            state.attempted = attempted;
            state.filled = filled;
            state.failed = failed;
            state.target = of;
          },
        });
        state.added = result.attempted;
        state.ranked = result.filled;
        state.attempted = result.attempted;
        state.filled = result.filled;
        state.failed = result.failed;
        state.target = result.batchSize;
        state.remaining = Number(photoFillPendingCount.get()?.c) || 0;
        if (result.stopped) {
          state.phase = "stopped";
          state.note = `Stopped after ${result.attempted} checked; ${result.filled} photos filled.`;
        } else if (result.providerFailure) {
          state.phase = "error";
          state.errorCode = result.providerFailure.code;
          state.error = "The photo provider became unavailable. Run this job again to resume.";
          state.note = `Saved ${result.filled} photos before the provider became unavailable; ${state.remaining} profiles still need photos.`;
        } else {
          state.phase = "done";
          state.note = `Checked ${result.attempted}; filled ${result.filled} photos; ${state.remaining} profiles still need photos.`;
        }
        state.finishedAt = Date.now();
      } catch (error) {
        state.error = "The missing-photo job could not finish. Run it again to resume.";
        state.errorCode = error instanceof ProviderError ? providerFailureCode(error) : "CATALOG_JOB_FAILED";
        state.phase = "error";
        state.finishedAt = Date.now();
      } finally {
        state.running = false;
        state.stopRequested = false;
        seedRunUpdate.run(state.phase, state.added, state.ranked, state.errorCode, state.note, state.finishedAt || Date.now(), runId);
      }
    })().catch((error) => reportDetachedSeedFailure(error, runId));
    return { started: true, status: catalogSeedStatus() };
  }

  // "refresh" mode: no crawl. Songs and genres are separate bounded phases:
  // an artist can already have tracks while still lacking a verified genre.
  if (mode === "refresh") {
    const runId = `seed_${randomUUID().slice(0, 12)}`;
    state = { runId, running: true, stopRequested: false, mode, phase: "songs", add: 0, target: startTotal, startTotal, added: 0, ranked: 0, total: startTotal, startedAt: Date.now(), finishedAt: 0, error: null, errorCode: null, note: "songs & genres" };
    seedRunInsert.run(runId, mode, "running", startTotal, startTotal, 0, 0, null, state.note, state.startedAt, null);
    void (async () => {
      try {
        const refresh = await refreshSongsAndGenres({
          shouldStop,
          songTick: ({ ranked, done, of }) => { state.ranked = ranked; state.added = done; state.target = of; },
          beforeGenres: () => { state.phase = "genres"; },
          genreTick: ({ fixed, done, of, songs }) => {
            state.ranked = songs + fixed;
            state.added = done;
            state.target = of;
          },
        });
        state.ranked = refresh.songs + refresh.genres.fixed;
        state.note = `songs ${refresh.songs}; genres ${refresh.genres.fixed}`;
        state.phase = state.stopRequested ? "stopped" : "done"; state.finishedAt = Date.now();
      } catch (e) {
        state.error = String(e?.message || e);
        state.errorCode = e instanceof ProviderError ? "PROVIDER_UNAVAILABLE" : "CATALOG_JOB_FAILED";
        state.phase = "error"; state.finishedAt = Date.now();
      } finally {
        state.running = false; state.stopRequested = false;
        seedRunUpdate.run(state.phase, state.added, state.ranked, state.errorCode, state.note, state.finishedAt || Date.now(), runId);
      }
    })().catch((error) => reportDetachedSeedFailure(error, runId));
    return { started: true, status: catalogSeedStatus() };
  }

  const target = startTotal + add; // absolute stop for the crawl
  const currentMax = db.prepare("SELECT COALESCE(MAX(next_off),0) n FROM seed_cursor").get().n;
  const calculatedDepth = currentMax + Math.max(600, Math.ceil(add / Math.max(1, GENRE_TAGS.length) / PAGE) * PAGE + 400);
  const crawlDepth = Number.isSafeInteger(perTag) && perTag > currentMax ? perTag : calculatedDepth;
  const runId = `seed_${randomUUID().slice(0, 12)}`;
  state = { runId, running: true, stopRequested: false, mode: "grow", phase: "crawl", add, target, startTotal, added: 0, ranked: 0, total: startTotal, startedAt: Date.now(), finishedAt: 0, error: null, errorCode: null, note: `crawl depth ${crawlDepth}` };
  seedRunInsert.run(runId, mode, "running", startTotal, target, 0, 0, null, state.note, state.startedAt, null);
  void (async () => {
    try {
      const result = await crawlArtists({ target, perTag: crawlDepth, shouldStop, tick: ({ added, total, note }) => { state.added = added; state.total = total; if (note) state.note = note; } });
      state.added = result.added; state.total = result.total;
      if (shouldEnrichAfterCrawl({ enrich, added: result.added, stopRequested: state.stopRequested })) {
        state.phase = "enrich";
        await enrichThin({ shouldStop, tick: ({ ranked }) => { state.ranked = ranked; } });
      }
      const outcome = growOutcome({ added: result.added, reachedTarget: result.reachedTarget, stopRequested: state.stopRequested });
      state.phase = outcome.phase;
      if (outcome.errorCode) state.errorCode = outcome.errorCode;
      if (outcome.note) state.note = outcome.note;
      state.finishedAt = Date.now();
    } catch (e) {
      state.error = String(e?.message || e);
      state.errorCode = e instanceof ProviderError ? "PROVIDER_UNAVAILABLE" : "CATALOG_JOB_FAILED";
      state.phase = "error"; state.finishedAt = Date.now();
    } finally {
      state.running = false; state.stopRequested = false;
      seedRunUpdate.run(state.phase, state.added, state.ranked, state.errorCode, state.note, state.finishedAt || Date.now(), runId);
    }
  })().catch((error) => reportDetachedSeedFailure(error, runId));
  return { started: true, status: catalogSeedStatus() };
}
