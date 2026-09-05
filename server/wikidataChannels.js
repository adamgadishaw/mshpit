// Free artist-channel discovery through Wikidata.
//
// MusicBrainz identities (P434) can map to YouTube channel IDs (P2397). This
// lets Pit learn many artist channels without spending the small search.list
// bucket. WDQS is an enrichment source, not a synchronous dependency we can
// hammer from a playback request: live lookups are short, deduplicated and
// concurrency-bounded; catalogue work is batched, retryable and persisted per
// MBID so no artist is stranded behind a JSON cursor.

import { db, artistStmts } from "./db.js";
import { youtubeJson } from "./musicProviders.js";
import { PROVIDER_JSON_LIMITS, readBoundedJsonResponse } from "./boundedJsonResponse.js";

const WIKIDATA_SPARQL = "https://query.wikidata.org/sparql";
const USER_AGENT = process.env.WIKIDATA_USER_AGENT
  || "mshpit-catalog/2.0 (https://www.mshpit.com; support@mshpit.com)";
const MBID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHANNEL_RE = /^UC[A-Za-z0-9_-]{22}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const CHECK_TTL_MS = Math.max(DAY_MS, Math.min(30 * DAY_MS,
  (Number(process.env.WIKIDATA_CHANNEL_TTL_DAYS) || 30) * DAY_MS));
const LIVE_TIMEOUT_MS = Math.max(1_000, Math.min(5_000,
  Number(process.env.WIKIDATA_LIVE_TIMEOUT_MS) || 2_500));
const LIVE_MAX_INFLIGHT = Math.max(1, Math.min(4,
  Number(process.env.WIKIDATA_LIVE_MAX_INFLIGHT) || 3));

const liveInflight = new Map();
const wikidataCircuit = { until: 0, code: null };

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Wikidata enrichment stopped.", "AbortError");
}

function abortableDelay(ms, signal) {
  throwIfAborted(signal);
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, ms);
    timer.unref?.();
    signal.addEventListener("abort", abort, { once: true });
    function cleanup() {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
    function finish() { cleanup(); resolve(); }
    function abort() {
      cleanup();
      reject(signal.reason instanceof Error
        ? signal.reason
        : new DOMException("Wikidata enrichment stopped.", "AbortError"));
    }
  });
}

const channelChecks = {
  get: db.prepare("SELECT mbid,channel_id,validated,checked_at FROM wikidata_channel_checks WHERE mbid=?"),
  set: db.prepare(`INSERT INTO wikidata_channel_checks (mbid,channel_id,validated,checked_at)
    VALUES (?,?,?,?) ON CONFLICT(mbid) DO UPDATE SET
      channel_id=excluded.channel_id,validated=excluded.validated,checked_at=excluded.checked_at`),
  stats: db.prepare(`SELECT COUNT(*) checked,
    SUM(CASE WHEN channel_id IS NOT NULL THEN 1 ELSE 0 END) matched
    FROM wikidata_channel_checks`),
};

const clampInteger = (value, fallback, min, max) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
};

const cleanMbid = (value) => {
  const id = String(value || "").trim().toLowerCase();
  return MBID_RE.test(id) ? id : null;
};

const normalizeName = (value) => String(value || "")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/&/g, " and ")
  .replace(/[^a-z0-9]+/g, " ")
  .trim()
  .replace(/\s+/g, " ");

// --- pure helpers -----------------------------------------------------------

export function buildSparql(mbids) {
  const values = [...new Set((mbids || []).map(cleanMbid).filter(Boolean))]
    .map((id) => `"${id}"`).join(" ");
  return `SELECT ?mbid ?yt WHERE {
  VALUES ?mbid { ${values} }
  ?artist wdt:P434 ?mbid .
  ?artist wdt:P2397 ?yt .
}
ORDER BY ?mbid ?yt`;
}

export function parseWikidataChannels(json) {
  const out = new Map();
  for (const row of json?.results?.bindings || []) {
    const mbid = cleanMbid(row?.mbid?.value);
    const channelId = String(row?.yt?.value || "").trim();
    if (!mbid || !CHANNEL_RE.test(channelId)) continue;
    if (!out.has(mbid)) out.set(mbid, []);
    const ids = out.get(mbid);
    if (!ids.includes(channelId)) ids.push(channelId);
  }
  // SPARQL result order is not an identity guarantee. A deterministic fallback
  // prevents two equivalent responses from choosing different channels.
  for (const ids of out.values()) ids.sort();
  return out;
}

export function channelTitleRank(artist, title) {
  const wanted = normalizeName(artist);
  const actual = normalizeName(title);
  if (!wanted || !actual) return 0;
  const wantedKey = wanted.replace(/ /g, "");
  const actualKey = actual.replace(/ /g, "");
  if (actual === `${wanted} topic`) return 100;
  if (actualKey === `${wantedKey}vevo`) return 95;
  if (actual === wanted) return 90;
  if (actual.startsWith(`${wanted} `)) return 75;
  if (actual.includes(wanted) || actualKey.includes(wantedKey)) return 55;
  return 0;
}

export function pickChannel(channelIds, titlesById = {}, artist = "") {
  const ids = [...new Set((channelIds || []).filter((id) => CHANNEL_RE.test(String(id))))].sort();
  if (!ids.length) return null;
  const ranked = ids.map((channelId) => ({
    channelId,
    rank: channelTitleRank(artist, titlesById[channelId]),
  })).sort((a, b) => b.rank - a.rank || a.channelId.localeCompare(b.channelId));
  return ranked[0].channelId;
}

function assessedChannel(channelIds, titlesById, artist) {
  const channelId = pickChannel(channelIds, titlesById, artist);
  if (!channelId) return null;
  const rank = channelTitleRank(artist, titlesById[channelId]);
  return { channelId, validated: rank >= 75, titleRank: rank };
}

// --- provider IO ------------------------------------------------------------

export class WikidataRequestError extends Error {
  constructor(message, { code = "wikidata_error", status = 0, retryAt = null } = {}) {
    super(message);
    this.name = "WikidataRequestError";
    this.code = code;
    this.status = status;
    this.retryAt = retryAt;
  }
}

function retryAtFrom(response, fallbackMs = 60_000) {
  const raw = response?.headers?.get?.("retry-after");
  if (raw && /^\d+$/.test(raw.trim())) return Date.now() + Number(raw) * 1000;
  const absolute = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(absolute) && absolute > Date.now() ? absolute : Date.now() + fallbackMs;
}

async function wikidataBatch(mbids, fetchImpl, timeoutMs, signal) {
  throwIfAborted(signal);
  if (wikidataCircuit.until > Date.now()) {
    throw new WikidataRequestError("Wikidata lookups are cooling down.", {
      code: "wikidata_paused",
      status: 503,
      retryAt: wikidataCircuit.until,
    });
  }

  let response;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  try {
    response = await fetchImpl(`${WIKIDATA_SPARQL}?query=${encodeURIComponent(buildSparql(mbids))}&format=json`, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/sparql-results+json",
        "Accept-Encoding": "gzip, deflate",
      },
      signal: requestSignal,
    });
  } catch (error) {
    throw new WikidataRequestError("Wikidata could not be reached.", {
      code: error?.name === "TimeoutError" || error?.name === "AbortError" ? "wikidata_timeout" : "wikidata_network",
    });
  }

  if (response.status === 429) {
    const retryAt = retryAtFrom(response);
    wikidataCircuit.until = retryAt;
    wikidataCircuit.code = "rate_limited";
    throw new WikidataRequestError("Wikidata asked Pit to slow down.", {
      code: "wikidata_rate_limited",
      status: 429,
      retryAt,
    });
  }
  if (!response.ok) {
    throw new WikidataRequestError(`Wikidata returned ${response.status}.`, {
      code: response.status >= 500 ? "wikidata_unavailable" : "wikidata_rejected",
      status: response.status,
    });
  }

  try {
    return parseWikidataChannels(await readBoundedJsonResponse(response, {
      maxBytes: PROVIDER_JSON_LIMITS.wikidata,
      signal: requestSignal,
    }));
  } catch {
    throw new WikidataRequestError("Wikidata returned an unreadable response.", { code: "wikidata_response" });
  }
}

async function channelTitles(ids, apiKey, fetchImpl, signal) {
  const titles = {};
  if (!apiKey || !ids.length) return { titles, checked: false };
  let checked = true;
  for (let i = 0; i < ids.length; i += 50) {
    throwIfAborted(signal);
    try {
      const data = await youtubeJson("channels", {
        part: "snippet",
        id: ids.slice(i, i + 50).join(","),
        maxResults: "50",
      }, apiKey, fetchImpl, 8_000, { signal });
      for (const item of data?.items || []) {
        if (item?.id && CHANNEL_RE.test(item.id)) titles[item.id] = item?.snippet?.title || "";
      }
    } catch {
      checked = false;
    }
  }
  return { titles, checked };
}

async function discoverOne(mbid, artist, { apiKey, fetchImpl, timeoutMs }) {
  const channels = await wikidataBatch([mbid], fetchImpl, timeoutMs);
  const rawIds = channels.get(mbid) || [];
  if (!rawIds.length) return null;
  const inspected = await channelTitles(rawIds, apiKey, fetchImpl);
  // A successful channels.list is also an existence check. If it completed,
  // drop IDs YouTube no longer recognizes; if YouTube itself was unavailable,
  // retain the CC0 identity but keep it explicitly untrusted.
  const eligible = inspected.checked ? rawIds.filter((id) => Object.hasOwn(inspected.titles, id)) : rawIds;
  return assessedChannel(eligible, inspected.titles, artist);
}

// A live miss is cached, but a provider failure is not. Different songs by the
// same artist share this promise and at most a few distinct artists may touch
// the public WDQS endpoint concurrently.
export async function lookupChannelByMbid(mbid, {
  artist = "",
  apiKey = process.env.YOUTUBE_API_KEY,
  fetchImpl = fetch,
  timeoutMs = LIVE_TIMEOUT_MS,
} = {}) {
  const id = cleanMbid(mbid);
  if (!id) return null;
  const now = Date.now();
  const cached = channelChecks.get.get(id);
  if (cached && now - Number(cached.checked_at) < CHECK_TTL_MS) {
    return cached.channel_id
      ? { channelId: cached.channel_id, validated: !!cached.validated, status: "cached" }
      : null;
  }
  if (wikidataCircuit.until > now) return null;
  const existing = liveInflight.get(id);
  if (existing) return existing;
  if (liveInflight.size >= LIVE_MAX_INFLIGHT) return null;

  const pending = (async () => {
    try {
      const found = await discoverOne(id, artist, {
        apiKey,
        fetchImpl,
        timeoutMs: clampInteger(timeoutMs, LIVE_TIMEOUT_MS, 500, 5_000),
      });
      channelChecks.set.run(id, found?.channelId || null, found?.validated ? 1 : 0, Date.now());
      return found ? { ...found, status: "fresh" } : null;
    } catch {
      return null;
    }
  })().finally(() => {
    if (liveInflight.get(id) === pending) liveInflight.delete(id);
  });
  liveInflight.set(id, pending);
  return pending;
}

export function wikidataProviderStatus() {
  const stats = channelChecks.stats.get() || {};
  const paused = wikidataCircuit.until > Date.now();
  return {
    checked: Number(stats.checked) || 0,
    matched: Number(stats.matched) || 0,
    inFlight: liveInflight.size,
    circuitOpen: paused,
    circuitCode: paused ? wikidataCircuit.code : null,
    retryAt: paused ? wikidataCircuit.until : null,
  };
}

async function wikidataBatchWithRetry(mbids, fetchImpl, timeoutMs, sleep, random, signal) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await wikidataBatch(mbids, fetchImpl, timeoutMs, signal);
    } catch (error) {
      throwIfAborted(signal);
      lastError = error;
      if (["wikidata_rate_limited", "wikidata_paused", "wikidata_rejected"].includes(error?.code)) throw error;
      if (attempt < 2) {
        const delay = Math.round(Math.min(5_000, 500 * (2 ** attempt)) * (0.8 + random() * 0.4));
        await sleep(delay, signal);
      }
    }
  }
  throw lastError;
}

/**
 * Backfill catalogue artist channels from Wikidata without using search.list.
 * State is filtered in SQL before LIMIT, aliases sharing one MBID are updated
 * together, misses are retried after the bounded TTL, and batch/provider errors
 * are visible to both the scheduler and CLI.
 */
export async function backfillChannelsFromWikidata({
  limit = 4_000,
  batchSize = 100,
  apiKey = process.env.YOUTUBE_API_KEY,
  fetchImpl = fetch,
  onProgress = null,
  sleep = abortableDelay,
  random = Math.random,
  signal,
} = {}) {
  throwIfAborted(signal);
  const safeLimit = clampInteger(limit, 4_000, 1, 50_000);
  const safeBatchSize = clampInteger(batchSize, 100, 1, 150);
  const cutoff = Date.now() - CHECK_TTL_MS;
  // LIMIT identities in the CTE, then join every alias for those identities.
  // Limiting artist rows could split one MBID's aliases at the boundary and
  // recreate the exact partial-update bug this durable state is replacing.
  const rows = db.prepare(`
    WITH eligible AS (
      SELECT lower(a.mbid) AS mbid,
        MAX(COALESCE(a.popularity, 0)) AS popularity,
        MAX(COALESCE(a.rank_score, 0)) AS rank_score
      FROM artists a
      LEFT JOIN wikidata_channel_checks w ON w.mbid = lower(a.mbid)
      WHERE a.mbid IS NOT NULL AND length(a.mbid) = 36 AND (
        w.mbid IS NULL OR w.checked_at < ? OR
        (w.channel_id IS NOT NULL AND (
          a.youtube_channel_id IS NULL OR a.youtube_channel_id = '' OR
          a.youtube_channel_id <> w.channel_id OR a.youtube_channel_at < w.checked_at
        ))
      )
      GROUP BY lower(a.mbid)
      ORDER BY popularity DESC, rank_score DESC, mbid
      LIMIT ?
    )
    SELECT a.norm,a.name,lower(a.mbid) AS mbid,
      a.youtube_channel_id AS current_channel,
      a.youtube_channel_at AS channel_at,a.youtube_channel_source AS channel_source,
      w.channel_id AS cached_channel,w.validated AS cached_validated,w.checked_at
    FROM eligible e
    JOIN artists a ON lower(a.mbid) = e.mbid
    LEFT JOIN wikidata_channel_checks w ON w.mbid = e.mbid
    ORDER BY e.popularity DESC,e.rank_score DESC,e.mbid,a.norm
  `).all(cutoff, safeLimit);

  const groups = new Map();
  for (const row of rows) {
    const mbid = cleanMbid(row.mbid);
    if (!mbid) continue;
    if (!groups.has(mbid)) groups.set(mbid, { mbid, rows: [], cached: null });
    const group = groups.get(mbid);
    group.rows.push(row);
    if (row.checked_at) {
      group.cached = {
        channelId: row.cached_channel || null,
        validated: !!row.cached_validated,
        checkedAt: Number(row.checked_at),
      };
    }
  }

  const identities = [...groups.values()];
  const stats = {
    considered: rows.length,
    identities: identities.length,
    matched: 0,
    stored: 0,
    cached: 0,
    batches: 0,
    failedBatches: 0,
    deferred: 0,
  };

  for (let i = 0; i < identities.length; i += safeBatchSize) {
    throwIfAborted(signal);
    const batch = identities.slice(i, i + safeBatchSize);
    const needsFetch = batch.filter((group) => !group.cached || group.cached.checkedAt < cutoff);
    let fetched = new Map();
    let titles = {};
    let titlesChecked = false;

    let fetchError = null;
    if (needsFetch.length) {
      try {
        fetched = await wikidataBatchWithRetry(needsFetch.map((group) => group.mbid), fetchImpl, 30_000, sleep, random, signal);
        const allIds = [...new Set([...fetched.values()].flat())];
        const inspected = await channelTitles(allIds, apiKey, fetchImpl, signal);
        titles = inspected.titles;
        titlesChecked = inspected.checked;
        stats.batches++;
      } catch (error) {
        throwIfAborted(signal);
        fetchError = error;
        stats.failedBatches++;
        stats.deferred += needsFetch.length;
        onProgress?.({ ...stats, error: String(error?.message || error), code: error?.code || "wikidata_error" });
        if (["wikidata_rate_limited", "wikidata_paused"].includes(error?.code)) break;
      }
    }

    const checkedAt = Date.now();
    throwIfAborted(signal);
    db.exec("BEGIN");
    try {
      for (const group of batch) {
        const needsNetwork = needsFetch.includes(group);
        if (needsNetwork && fetchError) continue;
        const wasFetched = needsNetwork;
        let channel;
        if (wasFetched) {
          let ids = fetched.get(group.mbid) || [];
          if (titlesChecked) ids = ids.filter((id) => Object.hasOwn(titles, id));
          channel = assessedChannel(ids, titles, group.rows[0]?.name || "");
          channelChecks.set.run(group.mbid, channel?.channelId || null, channel?.validated ? 1 : 0, checkedAt);
        } else if (group.cached?.channelId) {
          channel = {
            channelId: group.cached.channelId,
            validated: group.cached.validated,
            titleRank: 0,
          };
          stats.cached++;
        }

        if (channel?.channelId) {
          stats.matched++;
          const source = channel.validated ? "wikidata" : "wikidata_unverified";
          const mappingAt = wasFetched ? checkedAt : group.cached.checkedAt;
          for (const row of group.rows) {
            artistStmts.setWikidataChannel.run(channel.channelId, mappingAt, source, row.norm);
            stats.stored++;
          }
        } else if (wasFetched) {
          // Remove a mapping that Wikidata no longer asserts, but never erase a
          // separately discovered YouTube mapping on the strength of a WD miss.
          for (const row of group.rows) {
            if (String(row.channel_source || "").startsWith("wikidata")) artistStmts.clearChannel.run(row.norm);
          }
        }
      }
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }

    onProgress?.({ ...stats });
    if (needsFetch.length) await sleep(1_200, signal);
  }
  return stats;
}
