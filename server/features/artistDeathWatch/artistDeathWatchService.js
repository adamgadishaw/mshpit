import {
  ARTIST_DEATH_CANDIDATE_STATUSES,
  ARTIST_DEATH_WATCH_BATCH_SIZE,
  ARTIST_DEATH_WATCH_BATCHES_PER_RUN,
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

const WIKIDATA_FAILURE_CODES = new Set([
  "wikidata_timeout",
  "wikidata_network",
  "wikidata_rate_limited",
  "wikidata_unavailable",
  "wikidata_rejected",
  "wikidata_response",
]);

function recoverableWikidataFailure(error) {
  return WIKIDATA_FAILURE_CODES.has(safeErrorCode(error));
}

function exactCachedEvidenceCount(rows, repository, at) {
  let count = 0;
  for (const row of rows) {
    const artist = exactArtist(row);
    const candidate = artist ? repository.findCandidateByKey(artist.artistKey) : null;
    if (!candidate) continue;
    if (String(candidate.artist_key || "") !== artist.artistKey
      || canonicalArtistMbid(candidate.artist_mbid) !== artist.artistMbid
      || !canonicalWikidataId(candidate.wikidata_id)
      || !canonicalDeathDate(candidate.death_date, { at })) continue;
    count += 1;
  }
  return count;
}

export function createArtistDeathWatchService({
  repository,
  recentWikidataReader = readRecentWikidataDeaths,
  wikidataReader = readWikidataDeathSignals,
  musicBrainzReader = confirmMusicBrainzDeathSignal,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (!repository?.readSettings || !repository?.setEnabled || !repository?.recordScan
    || !repository?.eligibleArtistsAfter || !repository?.eligibleArtistCount
    || !repository?.catalogArtistCount || !repository?.eligibleArtistProgress
    || !repository?.catalogArtistForSignal
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
  let activeScanStartedAt = null;
  let lastProviderStatus = null;

  function snapshot() {
    repository.reconcilePublishedMemorials();
    const rawSettings = repository.readSettings();
    const settings = projectArtistDeathWatchSettings(rawSettings);
    if (!settings) throw new Error("Artist death watch settings are unavailable");
    const counts = repository.candidateCounts();
    const eligibleArtists = repository.eligibleArtistCount();
    const passComplete = eligibleArtists === 0
      || (!rawSettings?.cursor_artist_key && settings.lastSuccessAt != null);
    const checked = passComplete
      ? eligibleArtists
      : Math.min(eligibleArtists, repository.eligibleArtistProgress(rawSettings?.cursor_artist_key));
    return Object.freeze({
      settings,
      running: activeScan != null,
      startedAt: activeScanStartedAt,
      counts: Object.freeze({
        pending: Number(counts.pending) || 0,
        dismissed: Number(counts.dismissed) || 0,
        memorialized: Number(counts.memorialized) || 0,
      }),
      catalogArtists: repository.catalogArtistCount(),
      eligibleArtists,
      scanProgress: Object.freeze({
        checked,
        total: eligibleArtists,
        percent: eligibleArtists > 0 ? Math.round((checked / eligibleArtists) * 100) : 100,
        complete: passComplete,
      }),
      providerStatus: lastProviderStatus || Object.freeze({
        state: settings.lastErrorCode
          ? (settings.lastScanAt != null && settings.lastScanAt === settings.lastSuccessAt
            ? "degraded" : "unavailable")
          : "idle",
        errorCode: settings.lastErrorCode,
        catalog: null,
        recent: null,
      }),
      providerPolicy: Object.freeze({
        identity: "exact-mbid-and-wikidata",
        artistType: "Person",
        corroboration: "wikidata-and-musicbrainz",
        autoPublishes: false,
        batchSize: ARTIST_DEATH_WATCH_BATCH_SIZE,
        batchesPerRun: ARTIST_DEATH_WATCH_BATCHES_PER_RUN,
        maxCatalogChecksPerRun: ARTIST_DEATH_WATCH_BATCH_SIZE * ARTIST_DEATH_WATCH_BATCHES_PER_RUN,
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

    let cursorArtistKey = repository.readSettings()?.cursor_artist_key || null;
    let wrapped = false;
    let scanned = 0;
    let confirmations = 0;
    let inserted = 0;
    let reconfirmed = 0;
    let reopened = 0;
    let recentMatched = 0;
    let warningCode = null;
    let catalogError = null;
    let catalogBatchesChecked = 0;
    let cachedEvidence = 0;
    let recentState = "skipped";
    let recentError = null;
    let scanProviderStatus = null;

    try {
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

      // Exact catalogue batches are the source of truth. They run first so a
      // slow global provider query cannot stop progress through Mshpit artists.
      for (let batchIndex = 0; batchIndex < ARTIST_DEATH_WATCH_BATCHES_PER_RUN; batchIndex += 1) {
        let rows = repository.eligibleArtistsAfter({
          cursorArtistKey: cursorArtistKey || "",
          limit: ARTIST_DEATH_WATCH_BATCH_SIZE,
        });
        if (!rows.length) {
          // A persisted cursor may point at the exact final row from an older
          // release. Wrap only before this run has processed anything; wrapping
          // after a full batch would query the first rows again and double-scan
          // catalogues whose eligible count is an exact multiple of batch size.
          if (cursorArtistKey && !wrapped && scanned === 0) {
            cursorArtistKey = null;
            wrapped = true;
            rows = repository.eligibleArtistsAfter({
              cursorArtistKey: "",
              limit: ARTIST_DEATH_WATCH_BATCH_SIZE,
            });
          }
          if (!rows.length) break;
        }

        const seenMbids = new Set();
        const artists = rows.map(exactArtist).filter((artist) => {
          if (!artist || seenMbids.has(artist.artistMbid)) return false;
          seenMbids.add(artist.artistMbid);
          return true;
        });
        let wikidataSignals;
        try {
          wikidataSignals = await wikidataReader(artists, { at: scanAt, fetchImpl });
          catalogBatchesChecked += 1;
        } catch (error) {
          if (!recoverableWikidataFailure(error)) throw error;
          catalogError = error;
          warningCode = safeErrorCode(error);
          // These rows were already corroborated by both providers in an earlier
          // run. They can support a truthful degraded result, but are never used
          // to create or mutate a candidate and the failed batch cursor does not move.
          cachedEvidence = exactCachedEvidenceCount(rows, repository, scanAt);
          break;
        }
        let stoppedAtConfirmationLimit = false;

        for (const row of rows) {
          const artist = exactArtist(row);
          if (artist) {
            const signal = wikidataSignals.get(artist.artistKey);
            if (signal) {
              const existing = repository.findCandidateByKey(artist.artistKey);
              if (!existing || String(existing.artist_mbid).toLowerCase() !== artist.artistMbid
                || existing.wikidata_id !== signal.wikidataId || existing.death_date !== signal.deathDate) {
                if (!(await confirm(signal))) {
                  stoppedAtConfirmationLimit = true;
                  break;
                }
              }
            }
          }
          cursorArtistKey = typeof row?.artist_key === "string" ? row.artist_key : cursorArtistKey;
          scanned += 1;
        }

        if (stoppedAtConfirmationLimit) break;
        if (rows.length < ARTIST_DEATH_WATCH_BATCH_SIZE) {
          cursorArtistKey = null;
          wrapped = true;
          break;
        }
        // A full batch is not proof that another row exists. Probe the ordered
        // cursor directly so exact 40/80/200-row passes finish at 100% instead
        // of wrapping and rescanning from the beginning (or leaving a false
        // 100%-but-incomplete cursor after the five-batch budget).
        const hasSuccessor = repository.eligibleArtistsAfter({
          cursorArtistKey: cursorArtistKey || "",
          limit: 1,
        }).length > 0;
        if (!hasSuccessor) {
          cursorArtistKey = null;
          wrapped = true;
          break;
        }
      }

      // This global query accelerates very recent alerts, but it is capped and
      // provider-dependent. Its failure is a warning, not a failed catalogue
      // sweep, and never rolls back already confirmed candidates.
      if (confirmations < ARTIST_DEATH_WATCH_MAX_CONFIRMATIONS) {
        try {
          const lookbackFloor = scanAt - 90 * 24 * 60 * 60 * 1000;
          const priorSuccess = current.lastSuccessAt == null
            ? lookbackFloor : current.lastSuccessAt - 24 * 60 * 60 * 1000;
          const since = new Date(Math.max(0, lookbackFloor, priorSuccess)).toISOString().slice(0, 10);
          const recentSignalsResult = await recentWikidataReader({ since, limit: 100, at: scanAt, fetchImpl });
          recentState = "available";
          const recentSignals = Array.isArray(recentSignalsResult) ? recentSignalsResult : [];
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
        } catch (error) {
          if (!recoverableWikidataFailure(error)) throw error;
          recentError = error;
          recentState = "unavailable";
          warningCode ||= safeErrorCode(error);
        }
      }

      const hasLiveAuthoritativeCoverage = !catalogError
        || catalogBatchesChecked > 0
        || recentState === "available";
      const hasTruthfulPartial = hasLiveAuthoritativeCoverage || cachedEvidence > 0;
      const catalogState = catalogError
        ? (catalogBatchesChecked > 0 || cachedEvidence > 0 ? "degraded" : "unavailable")
        : "available";
      const state = warningCode
        ? (hasTruthfulPartial ? "degraded" : "unavailable")
        : "available";
      scanProviderStatus = Object.freeze({
        state,
        errorCode: warningCode,
        catalog: Object.freeze({
          state: catalogState,
          errorCode: catalogError ? safeErrorCode(catalogError) : null,
          batchesChecked: catalogBatchesChecked,
          cachedEvidence,
        }),
        recent: Object.freeze({
          state: recentState,
          errorCode: recentError ? safeErrorCode(recentError) : null,
        }),
      });
      lastProviderStatus = scanProviderStatus;
      // Do not suppress a total outage. A successful independent channel,
      // completed catalogue batch, or exact saved evidence is required.
      if (!hasTruthfulPartial) throw catalogError || recentError;

      repository.recordScan({
        cursorArtistKey,
        lastScanAt: scanAt,
        lastSuccessAt: hasLiveAuthoritativeCoverage ? scanAt : current.lastSuccessAt,
        nextScanAt: scanAt + ARTIST_DEATH_WATCH_INTERVAL_MS,
        lastErrorCode: warningCode,
        at: scanAt,
      });
      return {
        skipped: false,
        scanned,
        confirmations,
        inserted,
        reconfirmed,
        reopened,
        recentMatched,
        wrapped,
        warningCode,
        degraded: warningCode != null,
        cachedEvidence,
        ...snapshot(),
      };
    } catch (error) {
      if (!scanProviderStatus) {
        const errorCode = safeErrorCode(error);
        lastProviderStatus = Object.freeze({
          state: "unavailable",
          errorCode,
          catalog: catalogError ? Object.freeze({
            state: catalogBatchesChecked > 0 || cachedEvidence > 0 ? "degraded" : "unavailable",
            errorCode: safeErrorCode(catalogError),
            batchesChecked: catalogBatchesChecked,
            cachedEvidence,
          }) : null,
          recent: recentError ? Object.freeze({
            state: "unavailable",
            errorCode: safeErrorCode(recentError),
          }) : null,
        });
      }
      const retryAt = Number.isSafeInteger(Number(error?.retryAt)) && Number(error.retryAt) > scanAt
        ? Number(error.retryAt) : scanAt + ARTIST_DEATH_WATCH_INTERVAL_MS;
      repository.recordScan({
        cursorArtistKey,
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
      const requestedAt = Number(options?.at);
      activeScanStartedAt = Number.isSafeInteger(requestedAt) && requestedAt >= 0
        ? requestedAt : Date.now();
      const pending = performScan(options).finally(() => {
        if (activeScan === pending) {
          activeScan = null;
          activeScanStartedAt = null;
        }
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
