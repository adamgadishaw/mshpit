// Evidence-backed artist genre refresh.
//
// The legacy catalogue was grown from MusicBrainz tag searches. The tag used to
// discover an artist is not that artist's genre, so those labels remain hidden.
// This worker uses only an exact stored MBID lookup with `inc=genres`, records a
// primary claim only when the top positive vote is unique and supported by at
// least two votes, and runs outside HTTP requests through the shared background
// coordinator. A durable cursor and per-artist checked timestamp keep deploys
// from starting the catalogue over.

import { db } from "./db.js";
import { backgroundJobEnabled } from "./backgroundJobs.js";
import { runBackgroundJob } from "./backgroundJobCoordinator.js";
import { privateErrorLabel } from "./errors.js";
import { runMusicBrainzRequest } from "./musicBrainzRequestThrottle.js";
import { PROVIDER_JSON_LIMITS, readBoundedJsonResponse } from "./boundedJsonResponse.js";
import {
  musicBrainzGenreFields,
  projectArtistGenre,
  resolveGenre,
  storedClaims,
  withoutSource,
} from "../src/domain/genre.mjs";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
export const MUSICBRAINZ_GENRE_REFRESH_DEFAULT_BATCH = 30;
export const MUSICBRAINZ_GENRE_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_BATCH_LIMIT = MUSICBRAINZ_GENRE_REFRESH_DEFAULT_BATCH;
const DEFAULT_SCAN_LIMIT = 240;
const DEFAULT_INTERVAL_MS = MUSICBRAINZ_GENRE_REFRESH_INTERVAL_MS;
const DEFAULT_INITIAL_DELAY_MS = 2 * 60 * 1000;
const DEFAULT_RECHECK_MS = 180 * DAY;
const DEFAULT_FAILURE_RETRY_MS = DAY;
const CURSOR_KEY = "artist:genre:musicbrainz:cursor:v1";
const MUSICBRAINZ_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const USER_AGENT = "Mshpit/1.0 (https://mshpit.com)";

const boundedInteger = (value, fallback, minimum, maximum) => {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(minimum, Math.min(maximum, Math.floor(parsed)))
    : fallback;
};

const normalizedMbid = (value) => {
  const mbid = String(value || "").trim().toLowerCase();
  return MUSICBRAINZ_ID.test(mbid) ? mbid : "";
};

const cleanGenre = (value) => {
  if (typeof value !== "string") return "";
  const genre = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  return genre && [...genre].length <= 40 ? genre : "";
};

const rowData = (row) => {
  try {
    const parsed = JSON.parse(row?.data || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

export function musicBrainzArtistGenreEvidence(payload, expectedMbid, at = Date.now()) {
  const expected = normalizedMbid(expectedMbid);
  const actual = normalizedMbid(payload?.id);
  if (!expected || actual !== expected) return { status: "identity_mismatch", evidence: null };

  const names = new Set();
  const ids = new Set();
  const counts = [];
  for (const item of Array.isArray(payload?.genres) ? payload.genres : []) {
    const genre = cleanGenre(item?.name);
    const key = genre.toLocaleLowerCase("en-US");
    const id = normalizedMbid(item?.id);
    const count = Number(item?.count);
    if (!genre || !id || !Number.isSafeInteger(count) || count <= 0 || names.has(key) || ids.has(id)) continue;
    names.add(key);
    ids.add(id);
    counts.push({ genre, id, count });
  }
  counts.sort((left, right) => right.count - left.count || left.genre.localeCompare(right.genre));
  const boundedCounts = counts.slice(0, 12);
  const winner = boundedCounts[0];
  if (!winner) return { status: "empty", evidence: null };
  if (winner.count < 2) return { status: "weak", evidence: null };
  if (boundedCounts[1]?.count === winner.count) return { status: "tie", evidence: null };
  return {
    status: "verified",
    evidence: Object.freeze({
      genre: winner.genre,
      genreId: winner.id,
      provider: "musicbrainz",
      basis: "artist-genres-v1",
      artistMbid: expected,
      supportingCount: winner.count,
      counts: boundedCounts,
      checkedAt: Number.isFinite(Number(at)) ? Number(at) : Date.now(),
    }),
  };
}

export async function fetchExactMusicBrainzArtistGenres(mbid, {
  fetchImpl = globalThis.fetch,
  requestGate = runMusicBrainzRequest,
  signal,
  timeoutMs = 15_000,
} = {}) {
  const exactMbid = normalizedMbid(mbid);
  if (!exactMbid) throw new TypeError("A valid MusicBrainz artist ID is required.");
  if (signal?.aborted) throw signal.reason || new DOMException("Aborted", "AbortError");
  return requestGate(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), timeoutMs);
    timeout.unref?.();
    const abort = () => controller.abort(signal?.reason || new DOMException("Aborted", "AbortError"));
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await fetchImpl(
        `https://musicbrainz.org/ws/2/artist/${exactMbid}?inc=genres&fmt=json`,
        {
          headers: { Accept: "application/json", "User-Agent": USER_AGENT },
          signal: controller.signal,
        },
      );
      if (!response?.ok) {
        const error = new Error("MusicBrainz genre lookup failed.");
        error.status = Number(response?.status) || 502;
        throw error;
      }
      return await readBoundedJsonResponse(response, {
        maxBytes: PROVIDER_JSON_LIMITS.musicBrainz,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }, { signal });
}

function refreshDue(row, at, { recheckMs, failureRetryMs }) {
  const data = rowData(row);
  const projected = projectArtistGenre(data, row.genre);
  if (projected.genre && projected.genreSource !== "musicbrainz_genre") return false;
  const refresh = data.musicBrainzGenreRefresh;
  const checkedAt = Number(refresh?.checkedAt) || 0;
  if (checkedAt && at - checkedAt < recheckMs) return false;
  const attemptedAt = Number(refresh?.attemptedAt) || 0;
  if (refresh?.status === "provider_error" && attemptedAt && at - attemptedAt < failureRetryMs) return false;
  return true;
}

function cursorPosition(value) {
  try {
    const parsed = JSON.parse(String(value || ""));
    const rank = Number(parsed?.rank);
    const norm = typeof parsed?.norm === "string" ? parsed.norm : "";
    return Number.isSafeInteger(rank) && norm ? { rank, norm } : null;
  } catch {
    return null;
  }
}

function nextRows(database, cursor, scanLimit) {
  const columns = "norm,name,mbid,genre,data,updated_at,rank_score";
  const position = cursorPosition(cursor);
  if (!position) {
    return database.prepare(`SELECT ${columns} FROM artists
      WHERE mbid IS NOT NULL AND mbid<>'' ORDER BY rank_score DESC,norm LIMIT ?`).all(scanLimit);
  }
  const after = database.prepare(`SELECT ${columns} FROM artists
    WHERE mbid IS NOT NULL AND mbid<>''
      AND (rank_score < ? OR (rank_score = ? AND norm > ?))
    ORDER BY rank_score DESC,norm LIMIT ?`).all(position.rank, position.rank, position.norm, scanLimit);
  if (after.length >= scanLimit) return after;
  const wrapped = database.prepare(`SELECT ${columns} FROM artists
    WHERE mbid IS NOT NULL AND mbid<>''
      AND (rank_score > ? OR (rank_score = ? AND norm <= ?))
    ORDER BY rank_score DESC,norm LIMIT ?`).all(
    position.rank,
    position.rank,
    position.norm,
    scanLimit - after.length,
  );
  return [...after, ...wrapped];
}

function writeCursor(database, row) {
  if (!row?.norm || !Number.isSafeInteger(Number(row.rank_score))) return;
  database.prepare(`INSERT INTO app_meta (key,value) VALUES (?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(CURSOR_KEY, JSON.stringify({
    rank: Number(row.rank_score),
    norm: row.norm,
  }));
}

function clearMusicBrainzClaim(data, columnGenre) {
  const claims = withoutSource(storedClaims(data, columnGenre), "musicbrainz_genre");
  const record = resolveGenre(claims);
  const next = { ...data, genreClaims: claims };
  delete next.musicBrainzGenreEvidence;
  return { data: next, genre: record?.value || null };
}

function persistOutcome(database, row, result, at) {
  const existing = { ...rowData(row), mbid: normalizedMbid(row.mbid) };
  let nextData = existing;
  let nextGenre = row.genre || null;
  if (result.status === "verified") {
    const fields = musicBrainzGenreFields(existing, row.genre, result.evidence, at);
    if (!fields.genreClaims) return false;
    nextData = { ...existing, ...fields };
    nextGenre = fields.genre || null;
  } else if (result.status !== "provider_error") {
    const cleared = clearMusicBrainzClaim(existing, row.genre);
    nextData = cleared.data;
    nextGenre = cleared.genre;
  }
  nextData.musicBrainzGenreRefresh = result.status === "provider_error"
    ? { status: result.status, attemptedAt: at }
    : { status: result.status, attemptedAt: at, checkedAt: at };
  const updatedAt = Math.max(at, Number(row.updated_at) + 1 || at);
  return database.prepare(`UPDATE artists SET genre=?,data=?,updated_at=?
    WHERE norm=? AND mbid=? AND updated_at=?`).run(
      nextGenre,
      JSON.stringify(nextData),
      updatedAt,
      row.norm,
      row.mbid,
      row.updated_at,
    ).changes === 1;
}

export function createMusicBrainzGenreRefreshService({
  database = db,
  fetchArtist = fetchExactMusicBrainzArtistGenres,
  clock = Date.now,
  recheckMs = DEFAULT_RECHECK_MS,
  failureRetryMs = DEFAULT_FAILURE_RETRY_MS,
} = {}) {
  async function runBatch({ limit = DEFAULT_BATCH_LIMIT, scanLimit = DEFAULT_SCAN_LIMIT, signal } = {}) {
    if (signal?.aborted) throw signal.reason || new DOMException("Aborted", "AbortError");
    const at = Number(clock());
    const safeLimit = boundedInteger(limit, DEFAULT_BATCH_LIMIT, 1, 30);
    const safeScanLimit = boundedInteger(scanLimit, DEFAULT_SCAN_LIMIT, safeLimit, 2000);
    const cursor = database.prepare("SELECT value FROM app_meta WHERE key=?").get(CURSOR_KEY)?.value || "";
    const scanned = nextRows(database, cursor, safeScanLimit);
    const due = scanned.filter((row) => normalizedMbid(row.mbid)
      && refreshDue(row, at, { recheckMs, failureRetryMs })).slice(0, safeLimit);
    const stats = { scanned: scanned.length, attempted: 0, verified: 0, deferred: 0, failed: 0, stale: 0 };

    // If the whole scanned window is already fresh, advance across it. When
    // work is due, advance only after each attempted row; jumping to the end of
    // a 240-row scan after processing 30 would silently skip 210 due artists
    // and make the advertised first-pass duration untrue.
    if (!due.length && scanned.length) writeCursor(database, scanned.at(-1));

    for (let index = 0; index < due.length; index += 1) {
      if (signal?.aborted) throw signal.reason || new DOMException("Aborted", "AbortError");
      const row = due[index];
      let result;
      try {
        const payload = await fetchArtist(row.mbid, { signal });
        result = musicBrainzArtistGenreEvidence(payload, row.mbid, at);
      } catch (error) {
        if (signal?.aborted || error?.name === "AbortError") throw signal?.reason || error;
        result = Number(error?.status) === 404
          ? { status: "not_found", evidence: null }
          : { status: "provider_error", evidence: null };
        if (result.status === "provider_error") stats.failed += 1;
      }
      stats.attempted += 1;
      if (result.status === "verified") stats.verified += 1;
      else if (result.status !== "provider_error") stats.deferred += 1;
      if (!persistOutcome(database, row, result, at)) stats.stale += 1;
      writeCursor(database, row);
      // A rate limit, outage, timeout, or unreadable response is provider-wide,
      // not artist-specific. Stop this slice instead of repeating doomed work.
      if (result.status === "provider_error") break;
    }
    return stats;
  }
  return { runBatch };
}

export function isMusicBrainzGenreRefreshEnabled(env = process.env) {
  return backgroundJobEnabled(env, "ARTIST_GENRE_REFRESH_ENABLED");
}

let scheduler = null;

export function startMusicBrainzGenreRefreshScheduler({
  env = process.env,
  intervalMs = DEFAULT_INTERVAL_MS,
  initialDelayMs = DEFAULT_INITIAL_DELAY_MS,
  service = createMusicBrainzGenreRefreshService(),
  logger = console,
} = {}) {
  if (!isMusicBrainzGenreRefreshEnabled(env)) {
    logger.log?.("[pit] artist genre refresh disabled; set ARTIST_GENRE_REFRESH_ENABLED=true to opt in.");
    return null;
  }
  if (scheduler) return scheduler;
  const batchLimit = boundedInteger(env.ARTIST_GENRE_REFRESH_BATCH, DEFAULT_BATCH_LIMIT, 1, 30);
  const controller = new AbortController();
  const state = { first: null, timer: null, running: null, stopped: false };
  const trigger = () => {
    if (state.stopped || state.running) return state.running;
    state.running = runBackgroundJob(() => service.runBatch({ limit: batchLimit, signal: controller.signal }))
      .then((stats) => {
        if (stats.attempted) logger.log?.(`[pit] artist genres: ${stats.verified} verified, ${stats.deferred} still unknown, ${stats.failed} provider failures.`);
      })
      .catch((error) => {
        if (!state.stopped && error?.name !== "AbortError") {
          logger.error?.(`[pit] artist genre refresh failed safely cause=${privateErrorLabel(error)}`);
        }
      })
      .finally(() => { state.running = null; });
    return state.running;
  };
  state.first = setTimeout(trigger, Math.max(0, initialDelayMs));
  state.first.unref?.();
  state.timer = setInterval(trigger, Math.max(60_000, intervalMs));
  state.timer.unref?.();
  state.stop = ({ abortActive = true } = {}) => {
    if (state.stopped) return state.running || Promise.resolve();
    state.stopped = true;
    clearTimeout(state.first);
    clearInterval(state.timer);
    if (abortActive) controller.abort(new DOMException("Server stopping", "AbortError"));
    return state.running || Promise.resolve();
  };
  scheduler = state;
  return scheduler;
}

export function stopMusicBrainzGenreRefreshScheduler(options) {
  if (!scheduler) return Promise.resolve();
  const active = scheduler;
  scheduler = null;
  return active.stop(options);
}
