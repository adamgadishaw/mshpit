import {
  ARTIST_DEATH_CANDIDATE_STATUSES,
  ARTIST_DEATH_WATCH_BATCH_SIZE,
  ARTIST_DEATH_WATCH_INTERVAL_MS,
  ARTIST_DEATH_WATCH_MAX_CONFIRMATIONS,
  canonicalArtistMbid,
  canonicalDeathDate,
  canonicalWikidataId,
  parseDeathCandidateReview,
  projectArtistDeathCandidate,
  projectArtistDeathWatchSettings,
} from "../../../src/domain/artistDeathWatch.mjs";
import {
  confirmMusicBrainzDeathSignal,
  readRecentWikidataDeaths,
  readWikidataDeathSignals,
} from "./artistDeathWatchProviders.js";

const STATUS_SET = new Set(ARTIST_DEATH_CANDIDATE_STATUSES);

function timestamp(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new TypeError("Artist death watch requires a valid timestamp");
  return parsed;
}

function exactArtist(row) {
  const artistKey = typeof row?.artist_key === "string" ? row.artist_key.trim() : "";
  const artistName = typeof row?.artist_name === "string" ? row.artist_name.trim() : "";
  const artistMbid = canonicalArtistMbid(row?.artist_mbid);
  return artistKey && artistName && artistMbid
    ? Object.freeze({ artistKey, artistName, artistMbid }) : null;
}

function safeErrorCode(error) {
  const raw = typeof error?.code === "string" ? error.code.trim().toLowerCase() : "provider_error";
  return /^[a-z][a-z0-9_]{1,60}$/u.test(raw) ? raw : "provider_error";
}

export function createArtistDeathWatchService({
  repository,
  recentWikidataReader = readRecentWikidataDeaths,
  wikidataReader = readWikidataDeathSignals,
  musicBrainzReader = confirmMusicBrainzDeathSignal,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (!repository?.readSettings || !repository?.setEnabled || !repository?.recordScan
    || !repository?.eligibleArtistsAfter || !repository?.eligibleArtistCount || !repository?.catalogArtistForSignal
    || !repository?.findCandidateByKey
    || !repository?.saveConfirmedCandidate || !repository?.listCandidates
    || !repository?.candidateCounts || !repository?.reconcilePublishedMemorials
    || !repository?.review || !repository?.markMemorialized
    || typeof repository.transaction !== "function"
    || typeof recentWikidataReader !== "function" || typeof wikidataReader !== "function" || typeof musicBrainzReader !== "function"
    || typeof sleep !== "function") {
    throw new TypeError("Artist death watch requires complete service dependencies");
  }

  let activeScan = null;

  function snapshot() {
    repository.reconcilePublishedMemorials();
    const settings = projectArtistDeathWatchSettings(repository.readSettings());
    if (!settings) throw new Error("Artist death watch settings are unavailable");
    const counts = repository.candidateCounts();
    return Object.freeze({
      settings,
      counts: Object.freeze({
        pending: Number(counts.pending) || 0,
        dismissed: Number(counts.dismissed) || 0,
        memorialized: Number(counts.memorialized) || 0,
      }),
      eligibleArtists: repository.eligibleArtistCount(),
      providerPolicy: Object.freeze({
        identity: "exact-mbid-and-wikidata",
        artistType: "Person",
        corroboration: "wikidata-and-musicbrainz",
        autoPublishes: false,
        batchSize: ARTIST_DEATH_WATCH_BATCH_SIZE,
        maxConfirmationsPerRun: ARTIST_DEATH_WATCH_MAX_CONFIRMATIONS,
      }),
    });
  }

  async function performScan({ at, force = false, fetchImpl = fetch } = {}) {
    const scanAt = timestamp(at);
    const current = projectArtistDeathWatchSettings(repository.readSettings());
    if (!current) throw new Error("Artist death watch settings are unavailable");
    if (!current.enabled && !force) return { skipped: true, reason: "disabled", ...snapshot() };
    if (!force && current.nextScanAt != null && current.nextScanAt > scanAt) {
      return { skipped: true, reason: "not_due", ...snapshot() };
    }

    let rows = repository.eligibleArtistsAfter({
      cursorArtistKey: repository.readSettings()?.cursor_artist_key || "",
      limit: ARTIST_DEATH_WATCH_BATCH_SIZE,
    });
    let wrapped = false;
    if (!rows.length) {
      wrapped = true;
      rows = repository.eligibleArtistsAfter({ cursorArtistKey: "", limit: ARTIST_DEATH_WATCH_BATCH_SIZE });
    }
    const artists = [];
    const seenMbids = new Set();
    for (const row of rows) {
      const artist = exactArtist(row);
      if (!artist || seenMbids.has(artist.artistMbid)) continue;
      seenMbids.add(artist.artistMbid);
      artists.push(artist);
    }

    try {
      const lookbackFloor = scanAt - 90 * 24 * 60 * 60 * 1000;
      const priorSuccess = current.lastSuccessAt == null ? lookbackFloor : current.lastSuccessAt - 24 * 60 * 60 * 1000;
      const since = new Date(Math.max(0, lookbackFloor, priorSuccess)).toISOString().slice(0, 10);
      const recentSignalsResult = await recentWikidataReader({ since, limit: 100, at: scanAt, fetchImpl });
      const recentSignals = Array.isArray(recentSignalsResult) ? recentSignalsResult : [];
      const wikidataSignals = await wikidataReader(artists, { at: scanAt, fetchImpl });
      let confirmations = 0;
      let inserted = 0;
      let reconfirmed = 0;
      let reopened = 0;
      let recentMatched = 0;
      const confirm = async (signal) => {
        if (confirmations >= ARTIST_DEATH_WATCH_MAX_CONFIRMATIONS) return false;
        if (confirmations > 0) await sleep(1_100);
        confirmations += 1;
        const confirmation = await musicBrainzReader(signal, { at: scanAt, fetchImpl });
        if (confirmation?.artistType !== "Person"
          || canonicalArtistMbid(confirmation.artistMbid) !== signal.artistMbid
          || canonicalDeathDate(confirmation.deathDate, { at: scanAt }) !== signal.deathDate) return true;
        const saved = repository.saveConfirmedCandidate({ ...signal, at: scanAt });
        if (!saved.conflict) {
          if (saved.inserted) inserted += 1;
          else if (saved.reopened) reopened += 1;
          else reconfirmed += 1;
        }
        return true;
      };

      // Primary detector: a single bounded query for recent human deaths with a
      // MusicBrainz ID. Intersect both stable IDs locally before the much
      // smaller exact MusicBrainz corroboration step.
      for (const rawSignal of recentSignals) {
        const row = repository.catalogArtistForSignal(rawSignal);
        const artist = exactArtist(row);
        if (!artist) continue;
        const signal = {
          ...artist,
          wikidataId: canonicalWikidataId(rawSignal.wikidataId),
          deathDate: rawSignal.deathDate,
        };
        if (!signal.wikidataId) continue;
        const existing = repository.findCandidateByKey(artist.artistKey);
        if (existing && String(existing.artist_mbid).toLowerCase() === artist.artistMbid
          && existing.wikidata_id === signal.wikidataId && existing.death_date === signal.deathDate) continue;
        recentMatched += 1;
        if (!(await confirm(signal))) break;
      }

      let cursorArtistKey = wrapped ? null : (repository.readSettings()?.cursor_artist_key || null);
      for (const artist of artists) {
        const signal = wikidataSignals.get(artist.artistKey);
        if (signal) {
          const existing = repository.findCandidateByKey(artist.artistKey);
          if (!existing || String(existing.artist_mbid).toLowerCase() !== artist.artistMbid
            || existing.wikidata_id !== artist.wikidataId || existing.death_date !== signal.deathDate) {
            if (!(await confirm(signal))) break;
          }
        }
        cursorArtistKey = artist.artistKey;
      }
      repository.recordScan({
        cursorArtistKey,
        lastScanAt: scanAt,
        lastSuccessAt: scanAt,
        nextScanAt: scanAt + ARTIST_DEATH_WATCH_INTERVAL_MS,
        lastErrorCode: null,
        at: scanAt,
      });
      return {
        skipped: false,
        scanned: artists.length,
        confirmations,
        inserted,
        reconfirmed,
        reopened,
        recentMatched,
        wrapped,
        ...snapshot(),
      };
    } catch (error) {
      const retryAt = Number.isSafeInteger(Number(error?.retryAt)) && Number(error.retryAt) > scanAt
        ? Number(error.retryAt) : scanAt + ARTIST_DEATH_WATCH_INTERVAL_MS;
      repository.recordScan({
        cursorArtistKey: repository.readSettings()?.cursor_artist_key || null,
        lastScanAt: scanAt,
        lastSuccessAt: current.lastSuccessAt,
        nextScanAt: retryAt,
        lastErrorCode: safeErrorCode(error),
        at: scanAt,
      });
      throw error;
    }
  }

  return Object.freeze({
    readSnapshot() {
      return snapshot();
    },

    list({ status = "pending", limit = 50 } = {}) {
      const normalizedStatus = status == null || status === "" ? null : String(status).trim().toLowerCase();
      if (normalizedStatus && !STATUS_SET.has(normalizedStatus)) return null;
      const take = Math.max(1, Math.min(100, Math.trunc(Number(limit) || 50)));
      return repository.listCandidates({ status: normalizedStatus, limit: take })
        .map(projectArtistDeathCandidate).filter(Boolean);
    },

    setEnabled(enabled, { at, audit } = {}) {
      const updatedAt = timestamp(at);
      if (typeof enabled !== "boolean") return null;
      return repository.transaction(() => {
        const before = projectArtistDeathWatchSettings(repository.readSettings());
        const row = repository.setEnabled({ enabled, at: updatedAt });
        const after = projectArtistDeathWatchSettings(row);
        if (before?.enabled !== after?.enabled && typeof audit === "function") {
          audit({ previous: { enabled: before?.enabled === true }, next: { enabled: after.enabled } });
        }
        return { changed: before?.enabled !== after?.enabled, settings: after };
      });
    },

    scan(options) {
      if (activeScan) return activeScan;
      const pending = performScan(options).finally(() => {
        if (activeScan === pending) activeScan = null;
      });
      activeScan = pending;
      return pending;
    },

    review({ artistKey, status, reviewerId, at, audit } = {}) {
      const reviewedAt = timestamp(at);
      const normalizedStatus = parseDeathCandidateReview(status);
      const key = typeof artistKey === "string" ? artistKey.trim() : "";
      if (!key || !normalizedStatus || !reviewerId) return null;
      return repository.transaction(() => {
        const previous = repository.findCandidateByKey?.(key);
        if (!previous) return null;
        if (previous.status === "memorialized") return { changed: false, candidate: projectArtistDeathCandidate(previous) };
        const next = repository.review({ artistKey: key, status: normalizedStatus, reviewerId, at: reviewedAt });
        if (!next) return null;
        if (previous.status !== next.status && typeof audit === "function") {
          audit({ previous: { status: previous.status }, next: { status: next.status } });
        }
        return { changed: previous.status !== next.status, candidate: projectArtistDeathCandidate(next) };
      });
    },

    markMemorialized({ artistKey, artistMbid, reviewerId, at } = {}) {
      const updatedAt = timestamp(at);
      const mbid = canonicalArtistMbid(artistMbid);
      if (!artistKey || !mbid) return null;
      return projectArtistDeathCandidate(repository.markMemorialized({
        artistKey,
        artistMbid: mbid,
        reviewerId,
        at: updatedAt,
      }));
    },
  });
}
