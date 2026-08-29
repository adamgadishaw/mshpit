// Demand-driven tour-date coverage for artists people actually look at.
//
// HTTP reads only add a canonical public artist key to a durable queue. Provider
// traffic and SQLite event writes happen later, through the shared maintenance
// coordinator, so an artist page/search response never waits on a remote API.
// The queue intentionally stores no raw query, requester, account, or IP.
import { randomUUID } from "node:crypto";

import { db } from "./db.js";
import { runBackgroundJob } from "./backgroundJobCoordinator.js";
import {
  bandsintownRows,
  ticketmasterActiveAndFutureRange,
  ticketmasterArtistIdentity,
  ticketmasterEventSearchUrl,
  ticketmasterRows,
  upsertProviderTourDateRows,
} from "./tourdates.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const DEFAULT_SUCCESS_COOLDOWN_MS = 12 * HOUR;
const DEFAULT_FAILURE_COOLDOWN_MS = 15 * 60 * 1000;
const DEFAULT_RUNNING_LEASE_MS = 15 * 60 * 1000;
const DEFAULT_RETENTION_MS = 30 * DAY;
const DEFAULT_QUEUE_LIMIT = 128;
const DEFAULT_GLOBAL_HOURLY_LIMIT = 12;
const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_REQUEST_DELAY_MS = 550;
const DEFAULT_TICKETMASTER_WINDOW_DAYS = 180;
const TICKETMASTER_PAGE_SIZE = 200;
const TICKETMASTER_MAX_PAGES = 5;
const PROVIDER_RANGE_DAYS = 3 * 366;
const BUDGET_PREFIX = "tourdates:demand:global:v1:";
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const ERROR_PRIORITY = Object.freeze({
  provider_rate_limited: 5,
  provider_unavailable: 4,
  aborted: 3,
  provider_refresh_failed: 2,
  ticketmaster_coverage_limited: 1,
});

function boundedInteger(value, fallback, { min, max }) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function optionalLine(value, max) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const text = String(value).normalize("NFKC").replace(/\s+/gu, " ").trim();
  return text && [...text].length <= max ? text : "";
}

function enabledByEnvironment(env = process.env) {
  const raw = String(env.TOURDATE_DEMAND_REFRESH_ENABLED ?? "true").trim().toLowerCase();
  return !["0", "false", "no", "off", "disabled"].includes(raw);
}

function providerConfiguration(env = process.env) {
  return {
    ticketmasterKey: optionalLine(env.TICKETMASTER_KEY, 500),
    bandsintownAppId: optionalLine(env.BANDSINTOWN_APP_ID, 500),
  };
}

function providerFailureCode(error, signal) {
  const explicit = optionalLine(error?.providerCategory, 64);
  if (explicit && Object.hasOwn(ERROR_PRIORITY, explicit)) return explicit;
  if (signal?.aborted || error?.name === "AbortError") return "aborted";
  const status = Number(error?.status);
  if (status === 429) return "provider_rate_limited";
  if (status >= 500) return "provider_unavailable";
  return "provider_refresh_failed";
}

function strongestFailureCode(values) {
  return (values || [])
    .filter((value) => Object.hasOwn(ERROR_PRIORITY, value))
    .sort((left, right) => ERROR_PRIORITY[right] - ERROR_PRIORITY[left])[0]
    || "provider_refresh_failed";
}

function providerError(message, category) {
  const error = new Error(message);
  error.providerCategory = category;
  return error;
}

function responseExhausted(data, requestedPage, pageSize) {
  const rawTotalPages = data?.page?.totalPages;
  if (rawTotalPages !== null
      && rawTotalPages !== undefined
      && String(rawTotalPages).trim() !== "") {
    const totalPages = Number(rawTotalPages);
    if (Number.isSafeInteger(totalPages) && totalPages >= 0) {
      return requestedPage + 1 >= totalPages;
    }
  }
  const events = Array.isArray(data?._embedded?.events) ? data._embedded.events : [];
  return events.length < pageSize;
}

function providerIdentifier(value) {
  const id = optionalLine(value, 100);
  return /^[A-Za-z0-9_-]{1,100}$/u.test(id) ? id : "";
}

function validDateKey(value) {
  const key = optionalLine(value, 10);
  if (!DATE_KEY_PATTERN.test(key)) return "";
  const parsed = new Date(key + "T00:00:00.000Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === key ? key : "";
}

function dateKeyAt(at) {
  const timestamp = Number(at);
  if (!Number.isFinite(timestamp)) throw new TypeError("date timestamp must be finite");
  return new Date(timestamp).toISOString().slice(0, 10);
}

function addDateDays(dateKey, days) {
  const key = validDateKey(dateKey);
  if (!key) throw new TypeError("invalid date key");
  const value = new Date(key + "T00:00:00.000Z");
  value.setUTCDate(value.getUTCDate() + Number(days));
  return value.toISOString().slice(0, 10);
}

export function ticketmasterDemandScanWindow(queueRow = {}, at = Date.now(), {
  initialWindowDays = DEFAULT_TICKETMASTER_WINDOW_DAYS,
  horizonDays = PROVIDER_RANGE_DAYS,
} = {}) {
  const today = dateKeyAt(at);
  const storedCursor = validDateKey(queueRow.ticketmaster_scan_cursor_date);
  const cursorDate = storedCursor && storedCursor > today ? storedCursor : today;
  const storedHorizon = validDateKey(queueRow.ticketmaster_scan_horizon_date);
  const safeHorizonDays = boundedInteger(horizonDays, PROVIDER_RANGE_DAYS, { min: 1, max: PROVIDER_RANGE_DAYS });
  const horizonDate = storedHorizon && storedHorizon >= cursorDate
    ? storedHorizon
    : addDateDays(today, safeHorizonDays);
  const fallbackWindow = boundedInteger(
    initialWindowDays,
    DEFAULT_TICKETMASTER_WINDOW_DAYS,
    { min: 1, max: PROVIDER_RANGE_DAYS },
  );
  const windowDays = queueRow.ticketmaster_window_days == null
    ? fallbackWindow
    : boundedInteger(
      queueRow.ticketmaster_window_days,
      fallbackWindow,
      { min: 1, max: PROVIDER_RANGE_DAYS },
    );
  const candidateEnd = addDateDays(cursorDate, windowDays - 1);
  const endDate = candidateEnd < horizonDate ? candidateEnd : horizonDate;
  return {
    cursorDate,
    endDate,
    horizonDate,
    windowDays,
    startEndDateTime: [
      addDateDays(cursorDate, -1) + "T00:00:00Z",
      addDateDays(endDate, 1) + "T23:59:59Z",
    ],
  };
}

export function exactTicketmasterAttractionIds(data, artistName) {
  const requested = ticketmasterArtistIdentity(artistName);
  const ids = new Set();
  for (const event of Array.isArray(data?._embedded?.events) ? data._embedded.events : []) {
    for (const attraction of Array.isArray(event?._embedded?.attractions) ? event._embedded.attractions : []) {
      const id = providerIdentifier(attraction?.id);
      if (id && ticketmasterArtistIdentity(attraction?.name) === requested) ids.add(id);
    }
  }
  return [...ids];
}

function abortableDelay(ms, { signal } = {}) {
  if (!ms) return Promise.resolve();
  if (signal?.aborted) return Promise.reject(signal.reason || new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const finish = (callback, value) => {
      signal?.removeEventListener("abort", abort);
      callback(value);
    };
    const timer = setTimeout(() => finish(resolve), ms);
    timer.unref?.();
    const abort = () => {
      clearTimeout(timer);
      finish(reject, signal.reason || new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export async function fetchTourProviderJson(url, {
  signal,
  fetchImpl = globalThis.fetch,
  timeoutMs = 15_000,
} = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), timeoutMs);
  timeout.unref?.();
  const abort = () => controller.abort(signal?.reason || new DOMException("Aborted", "AbortError"));
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { "User-Agent": "mshpit.com" },
    });
    if (!response.ok) {
      const error = new Error("Tour-date provider request failed");
      error.status = response.status;
      throw error;
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

function providerRowIdentity(row, position = 0) {
  const source = optionalLine(row?.source, 40).toLocaleLowerCase("en");
  const providerEventId = providerIdentifier(row?.provider_event_id) || optionalLine(row?.id, 240);
  return providerEventId ? source + "|" + providerEventId : "unidentified|" + position;
}

async function collectTicketmasterMode({
  apiKey,
  artistName,
  attractionId,
  fetchJson,
  wait,
  signal,
  requestDelayMs,
  pageSize,
  maxPages,
  at,
  startEndDateTime,
  scanStartDate,
  scanEndDate,
}) {
  const name = optionalLine(artistName, 160);
  const identity = ticketmasterArtistIdentity(name);
  const exactAttractionId = providerIdentifier(attractionId);
  const safePageSize = boundedInteger(pageSize, TICKETMASTER_PAGE_SIZE, { min: 1, max: 200 });
  const providerMaxPage = Math.floor(999 / safePageSize);
  const safeMaxPages = Math.min(
    providerMaxPage + 1,
    boundedInteger(maxPages, TICKETMASTER_MAX_PAGES, { min: 1, max: 5 }),
  );
  const safeDelay = boundedInteger(requestDelayMs, DEFAULT_REQUEST_DELAY_MS, { min: 0, max: 5000 });
  const rowsByIdentity = new Map();
  const discoveredAttractionIds = new Set();
  let exactEventCount = 0;
  let pagesFetched = 0;

  for (let page = 0; page < safeMaxPages; page += 1) {
    if (page > 0 && safeDelay) await wait(safeDelay, { signal });
    let data;
    try {
      const requestUrl = new URL(ticketmasterEventSearchUrl({
        apiKey,
        keyword: exactAttractionId ? undefined : name,
        size: safePageSize,
        page,
        startEndDateTime: startEndDateTime || ticketmasterActiveAndFutureRange(at, PROVIDER_RANGE_DAYS),
      }));
      if (exactAttractionId) requestUrl.searchParams.set("attractionId", exactAttractionId);
      data = await fetchJson(requestUrl.toString(), { signal });
    } catch (error) {
      if (!pagesFetched) throw error;
      return {
        rows: [...rowsByIdentity.values()],
        complete: false,
        limited: false,
        pagesFetched,
        exactEventCount,
        attractionIds: [...discoveredAttractionIds],
        error,
        errorCategory: providerFailureCode(error, signal),
      };
    }

    pagesFetched += 1;
    const exactEvents = (Array.isArray(data?._embedded?.events) ? data._embedded.events : []).filter((event) => {
      const attractions = Array.isArray(event?._embedded?.attractions) ? event._embedded.attractions : [];
      return attractions.some((attraction) =>
        ticketmasterArtistIdentity(attraction?.name) === identity
          && (!exactAttractionId || providerIdentifier(attraction?.id) === exactAttractionId));
    });
    exactEventCount += exactEvents.length;
    const exactData = { ...data, _embedded: { ...(data?._embedded || {}), events: exactEvents } };
    for (const id of exactTicketmasterAttractionIds(exactData, name)) discoveredAttractionIds.add(id);
    for (const row of ticketmasterRows(exactData, { requestedArtist: name })) {
      if (scanStartDate && row.date < scanStartDate) continue;
      if (scanEndDate && row.date > scanEndDate) continue;
      const rowIdentity = providerRowIdentity(row);
      if (!rowsByIdentity.has(rowIdentity)) rowsByIdentity.set(rowIdentity, row);
    }
    if (responseExhausted(data, page, safePageSize)) {
      return {
        rows: [...rowsByIdentity.values()],
        complete: true,
        limited: false,
        pagesFetched,
        exactEventCount,
        attractionIds: [...discoveredAttractionIds],
      };
    }
  }

  return {
    rows: [...rowsByIdentity.values()],
    complete: false,
    limited: true,
    pagesFetched,
    exactEventCount,
    attractionIds: [...discoveredAttractionIds],
    errorCategory: "ticketmaster_coverage_limited",
  };
}

// Ticketmaster keyword search is fuzzy. Every accepted event must include the
// exact requested attraction identity. A cached provider ID that yields no
// usable rows receives one exact-name fallback before the cache can change.
export async function collectExactTicketmasterArtistDates({
  apiKey,
  artistName,
  attractionId,
  fetchJson = fetchTourProviderJson,
  wait = abortableDelay,
  signal,
  requestDelayMs = DEFAULT_REQUEST_DELAY_MS,
  pageSize = TICKETMASTER_PAGE_SIZE,
  maxPages = TICKETMASTER_MAX_PAGES,
  at = Date.now(),
  startEndDateTime,
  scanStartDate,
  scanEndDate,
} = {}) {
  const name = optionalLine(artistName, 160);
  const identity = ticketmasterArtistIdentity(name);
  const knownAttractionId = providerIdentifier(attractionId);
  if (!apiKey || !name || !identity) {
    return {
      rows: [],
      complete: true,
      limited: false,
      pagesFetched: 0,
      attractionId: knownAttractionId || null,
      attractionCacheAction: "keep",
      fallbackAttempted: false,
    };
  }

  const shared = {
    apiKey,
    artistName: name,
    fetchJson,
    wait,
    signal,
    requestDelayMs,
    pageSize,
    maxPages,
    at,
    startEndDateTime,
    scanStartDate: validDateKey(scanStartDate) || "",
    scanEndDate: validDateKey(scanEndDate) || "",
  };
  const primary = await collectTicketmasterMode({ ...shared, attractionId: knownAttractionId });
  const primaryIds = primary.attractionIds.map(providerIdentifier).filter(Boolean);
  if (!knownAttractionId) {
    return {
      ...primary,
      attractionId: primaryIds.length === 1 ? primaryIds[0] : null,
      attractionCacheAction: primaryIds.length === 1 ? "replace" : "keep",
      fallbackAttempted: false,
    };
  }
  if (!primary.complete || primary.rows.length > 0) {
    return {
      ...primary,
      attractionId: knownAttractionId,
      attractionCacheAction: "keep",
      fallbackAttempted: false,
    };
  }

  let fallback;
  try {
    fallback = await collectTicketmasterMode({ ...shared, attractionId: null });
  } catch (error) {
    return {
      ...primary,
      complete: false,
      limited: false,
      error,
      errorCategory: providerFailureCode(error, signal),
      attractionId: knownAttractionId,
      attractionCacheAction: "keep",
      fallbackAttempted: true,
    };
  }
  const fallbackIds = fallback.attractionIds.map(providerIdentifier).filter(Boolean);
  const verifiedIdentity = fallback.exactEventCount > 0 || fallbackIds.length > 0;
  const attractionCacheAction = verifiedIdentity
    ? (fallbackIds.length === 1 ? "replace" : "clear")
    : "keep";
  return {
    ...fallback,
    pagesFetched: primary.pagesFetched + fallback.pagesFetched,
    attractionId: attractionCacheAction === "replace"
      ? fallbackIds[0]
      : (attractionCacheAction === "clear" ? null : knownAttractionId),
    attractionCacheAction,
    fallbackAttempted: true,
  };
}

export function exactBandsintownArtistEvents(data, artistName) {
  const requested = ticketmasterArtistIdentity(artistName);
  if (!requested) return [];
  return (Array.isArray(data) ? data : []).filter((event) => {
    const identities = [
      event?.artist?.name,
      ...(Array.isArray(event?.lineup) ? event.lineup : []),
    ].map(ticketmasterArtistIdentity).filter(Boolean);
    return identities.includes(requested);
  });
}

export async function collectExactBandsintownArtistDates({
  appId,
  artistName,
  fetchJson = fetchTourProviderJson,
  signal,
} = {}) {
  const name = optionalLine(artistName, 160);
  if (!appId || !name) return { rows: [], complete: true };
  const encodedName = encodeURIComponent(name).replace(/%2F/giu, "%252F");
  const url = "https://rest.bandsintown.com/artists/" + encodedName
    + "/events?app_id=" + encodeURIComponent(appId) + "&date=upcoming";
  const data = await fetchJson(url, { signal });
  return {
    rows: bandsintownRows(exactBandsintownArtistEvents(data, name), { requestedArtist: name }),
    complete: true,
  };
}

export function dedupeExactProviderRows(rows) {
  const byProviderIdentity = new Map();
  let position = 0;
  for (const row of rows || []) {
    const key = providerRowIdentity(row, position);
    position += 1;
    if (!byProviderIdentity.has(key)) byProviderIdentity.set(key, row);
  }
  return [...byProviderIdentity.values()];
}

export async function refreshExactArtistFromProviders({
  artistName,
  ticketmasterAttractionId,
  env = process.env,
  fetchJson = fetchTourProviderJson,
  wait = abortableDelay,
  signal,
  at = Date.now(),
  includeTicketmaster = true,
  includeBandsintown = true,
  startEndDateTime,
  scanStartDate,
  scanEndDate,
} = {}) {
  const { ticketmasterKey, bandsintownAppId } = providerConfiguration(env);
  const rows = [];
  const failureCategories = [];
  let completedProviders = 0;
  let failedProviders = 0;
  let partialProviders = 0;
  const ticketmaster = {
    configured: !!ticketmasterKey,
    attempted: false,
    complete: false,
    limited: false,
    attractionId: providerIdentifier(ticketmasterAttractionId) || null,
    attractionCacheAction: "keep",
    errorCategory: null,
  };
  const bandsintown = {
    configured: !!bandsintownAppId,
    attempted: false,
    complete: false,
    errorCategory: null,
  };

  if (ticketmasterKey && includeTicketmaster) {
    ticketmaster.attempted = true;
    try {
      const result = await collectExactTicketmasterArtistDates({
        apiKey: ticketmasterKey,
        artistName,
        attractionId: ticketmaster.attractionId,
        fetchJson,
        wait,
        signal,
        at,
        startEndDateTime,
        scanStartDate,
        scanEndDate,
      });
      rows.push(...result.rows);
      Object.assign(ticketmaster, {
        complete: result.complete === true,
        limited: result.limited === true,
        attractionId: providerIdentifier(result.attractionId) || null,
        attractionCacheAction: result.attractionCacheAction || "keep",
        errorCategory: result.errorCategory || null,
        fallbackAttempted: result.fallbackAttempted === true,
        pagesFetched: result.pagesFetched,
      });
      if (result.complete) completedProviders += 1;
      else {
        partialProviders += 1;
        failureCategories.push(result.errorCategory || "provider_refresh_failed");
      }
    } catch (error) {
      failedProviders += 1;
      ticketmaster.errorCategory = providerFailureCode(error, signal);
      failureCategories.push(ticketmaster.errorCategory);
    }
  }
  if (bandsintownAppId && includeBandsintown && !signal?.aborted) {
    bandsintown.attempted = true;
    try {
      const result = await collectExactBandsintownArtistDates({
        appId: bandsintownAppId,
        artistName,
        fetchJson,
        signal,
      });
      rows.push(...result.rows);
      bandsintown.complete = true;
      completedProviders += 1;
    } catch (error) {
      failedProviders += 1;
      bandsintown.errorCategory = providerFailureCode(error, signal);
      failureCategories.push(bandsintown.errorCategory);
    }
  }
  if (signal?.aborted) throw signal.reason || new DOMException("Aborted", "AbortError");
  const attemptedProviders = Number(ticketmaster.attempted) + Number(bandsintown.attempted);
  if (attemptedProviders && !completedProviders && !partialProviders) {
    throw providerError(
      "Every configured exact-artist provider failed (" + failedProviders + ")",
      strongestFailureCode(failureCategories),
    );
  }
  return {
    rows: dedupeExactProviderRows(rows),
    complete: attemptedProviders === 0
      || (completedProviders === attemptedProviders && partialProviders === 0 && failedProviders === 0),
    completedProviders,
    partialProviders,
    failedProviders,
    errorCategory: failureCategories.length ? strongestFailureCode(failureCategories) : null,
    ticketmasterAttractionId: ticketmaster.attractionId,
    ticketmaster,
    bandsintown,
  };
}

export function exactCatalogArtistForDemandRefresh(rows, query) {
  const identity = ticketmasterArtistIdentity(optionalLine(query, 160));
  if (!identity) return null;
  const matches = (Array.isArray(rows) ? rows : []).filter((row) =>
    row?.norm && ticketmasterArtistIdentity(row.name) === identity);
  return matches.length === 1 ? matches[0] : null;
}

// A completed exact scan is authoritative only for its one artist and one
// inclusive date window. Reconciliation is reversible: it never deletes an
// event, never touches member-owned rows, and never crosses provider, artist,
// or window boundaries. Partial/capped scans never call this helper.
export function reconcileExactArtistTicketmasterWindow(database, {
  artistKey,
  scanStartDate,
  scanEndDate,
  seenSince,
} = {}) {
  const key = optionalLine(artistKey, 200).toLocaleLowerCase("en");
  const startDate = validDateKey(scanStartDate);
  const endDate = validDateKey(scanEndDate);
  const cutoff = Number(seenSince);
  if (!key || !startDate || !endDate || startDate > endDate
      || !Number.isSafeInteger(cutoff) || cutoff < 0) {
    throw new TypeError("exact Ticketmaster reconciliation requires a valid artist, window, and timestamp");
  }
  return Number(database.prepare(
    "UPDATE tour_dates SET provider_active=0,updated_at=@seen_since "
      + "WHERE owner_id IS NULL AND source='ticketmaster' "
      + "AND artist_key=@artist_key AND date>=@start_date AND date<=@end_date "
      + "AND provider_active<>0 AND ("
      + "COALESCE(last_seen_at,updated_at)<@seen_since "
      + "OR lower(COALESCE(event_status,'')) IN ('cancelled','canceled'))",
  ).run({
    artist_key: key,
    start_date: startDate,
    end_date: endDate,
    seen_since: cutoff,
  }).changes) || 0;
}

function nextGlobalBucket(at) {
  return (Math.floor(at / HOUR) + 1) * HOUR;
}

function budgetKey(at) {
  return BUDGET_PREFIX + Math.floor(at / HOUR);
}

function queueOptions(env, overrides) {
  return {
    successCooldownMs: boundedInteger(overrides.successCooldownMs, DEFAULT_SUCCESS_COOLDOWN_MS, { min: 1, max: 7 * DAY }),
    failureCooldownMs: boundedInteger(overrides.failureCooldownMs, DEFAULT_FAILURE_COOLDOWN_MS, { min: 1, max: DAY }),
    runningLeaseMs: boundedInteger(overrides.runningLeaseMs, DEFAULT_RUNNING_LEASE_MS, { min: 1000, max: HOUR }),
    retentionMs: boundedInteger(overrides.retentionMs, DEFAULT_RETENTION_MS, { min: DAY, max: 180 * DAY }),
    queueLimit: boundedInteger(overrides.queueLimit ?? env.TOURDATE_DEMAND_QUEUE_LIMIT, DEFAULT_QUEUE_LIMIT, { min: 1, max: 500 }),
    globalHourlyLimit: boundedInteger(
      overrides.globalHourlyLimit ?? env.TOURDATE_DEMAND_HOURLY_LIMIT,
      DEFAULT_GLOBAL_HOURLY_LIMIT,
      { min: 1, max: 60 },
    ),
    maxAttempts: boundedInteger(overrides.maxAttempts, DEFAULT_MAX_ATTEMPTS, { min: 1, max: 10 }),
    interJobDelayMs: boundedInteger(overrides.interJobDelayMs, DEFAULT_REQUEST_DELAY_MS, { min: 0, max: 5000 }),
    ticketmasterWindowDays: boundedInteger(
      overrides.ticketmasterWindowDays ?? env.TOURDATE_DEMAND_WINDOW_DAYS,
      DEFAULT_TICKETMASTER_WINDOW_DAYS,
      { min: 1, max: PROVIDER_RANGE_DAYS },
    ),
  };
}

function attractionValueAfterResult(queueRow, result) {
  const report = result?.ticketmaster;
  if (report?.attractionCacheAction === "clear") return null;
  if (report?.attractionCacheAction === "replace") {
    return providerIdentifier(report.attractionId) || null;
  }
  const legacy = providerIdentifier(result?.ticketmasterAttractionId);
  return legacy || providerIdentifier(queueRow.ticketmaster_attraction_id) || null;
}

export function createArtistTourDateDemandRefreshService({
  database,
  env = process.env,
  clock = () => Date.now(),
  runJob = runBackgroundJob,
  refreshArtist = (refreshOptions) => refreshExactArtistFromProviders(refreshOptions),
  persistRows = (rows, seenAt) => upsertProviderTourDateRows(database, rows, { seenAt }),
  claimTokenFactory = randomUUID,
  logger = console,
  autoSchedule = true,
  ...overrides
} = {}) {
  if (!database) throw new TypeError("database is required");
  const options = queueOptions(env, overrides);
  const catalogByKey = database.prepare("SELECT norm,name FROM artists WHERE norm=?");
  const queueByKey = database.prepare("SELECT * FROM artist_tourdate_refresh_queue WHERE artist_key=?");
  const activeQueueCount = database.prepare(
    "SELECT COUNT(*) count FROM artist_tourdate_refresh_queue WHERE status IN ('pending','running')",
  );
  const pruneCooldowns = database.prepare(
    "DELETE FROM artist_tourdate_refresh_queue WHERE status='cooldown' AND updated_at<?",
  );
  const recoverExpired = database.prepare(
    "UPDATE artist_tourdate_refresh_queue"
      + " SET status='pending',claim_token=NULL,not_before=?,last_error_code='interrupted',updated_at=?"
      + " WHERE status='running' AND not_before<=?",
  );
  const nextCandidate = database.prepare(
    "SELECT queue.*,artist.name FROM artist_tourdate_refresh_queue queue"
      + " JOIN artists artist ON artist.norm=queue.artist_key"
      + " WHERE queue.status='pending' AND queue.not_before<=?"
      + " ORDER BY queue.requested_at ASC,queue.artist_key ASC LIMIT 1",
  );
  const nextDue = database.prepare(
    "SELECT MIN(not_before) due_at FROM artist_tourdate_refresh_queue"
      + " WHERE status IN ('pending','running')",
  );
  const enqueueRow = database.prepare(
    "INSERT INTO artist_tourdate_refresh_queue ("
      + "artist_key,status,requested_at,not_before,attempted_at,succeeded_at,attempt_count,"
      + "ticketmaster_attraction_id,claim_token,ticketmaster_scan_cursor_date,"
      + "ticketmaster_scan_horizon_date,ticketmaster_window_days,ticketmaster_coverage_limited,"
      + "ticketmaster_scan_completed,bandsintown_refresh_completed,last_error_code,updated_at"
      + ") VALUES (?,'pending',?,?,NULL,NULL,0,NULL,NULL,NULL,NULL,NULL,0,0,0,NULL,?)"
      + " ON CONFLICT(artist_key) DO UPDATE SET"
      + " status='pending',requested_at=excluded.requested_at,not_before=excluded.not_before,"
      + " attempted_at=NULL,succeeded_at=NULL,attempt_count=0,claim_token=NULL,"
      + " ticketmaster_scan_cursor_date=NULL,ticketmaster_scan_horizon_date=NULL,"
      + " ticketmaster_window_days=NULL,ticketmaster_coverage_limited=0,"
      + " ticketmaster_scan_completed=0,bandsintown_refresh_completed=0,"
      + " last_error_code=NULL,updated_at=excluded.updated_at",
  );
  const claimRow = database.prepare(
    "UPDATE artist_tourdate_refresh_queue"
      + " SET status='running',claim_token=?,attempted_at=?,not_before=?,attempt_count=attempt_count+1,"
      + " last_error_code=NULL,updated_at=?"
      + " WHERE artist_key=? AND status='pending' AND not_before<=?",
  );
  const deferRow = database.prepare(
    "UPDATE artist_tourdate_refresh_queue SET not_before=?,updated_at=?"
      + " WHERE artist_key=? AND status='pending'",
  );
  const settleRow = database.prepare(
    "UPDATE artist_tourdate_refresh_queue SET "
      + "status=@status,not_before=@not_before,succeeded_at=@succeeded_at,"
      + "attempt_count=@attempt_count,claim_token=NULL,"
      + "ticketmaster_attraction_id=@ticketmaster_attraction_id,"
      + "ticketmaster_scan_cursor_date=@ticketmaster_scan_cursor_date,"
      + "ticketmaster_scan_horizon_date=@ticketmaster_scan_horizon_date,"
      + "ticketmaster_window_days=@ticketmaster_window_days,"
      + "ticketmaster_coverage_limited=@ticketmaster_coverage_limited,"
      + "ticketmaster_scan_completed=@ticketmaster_scan_completed,"
      + "bandsintown_refresh_completed=@bandsintown_refresh_completed,"
      + "last_error_code=@last_error_code,updated_at=@updated_at "
      + "WHERE artist_key=@artist_key AND status='running' "
      + "AND claim_token=@claim_token AND attempted_at=@attempted_at "
      + "AND not_before>@finished_at",
  );
  const readBudget = database.prepare(
    "INSERT INTO app_meta (key,value) VALUES (?,'1')"
      + " ON CONFLICT(key) DO UPDATE SET value=CAST(app_meta.value AS INTEGER)+1"
      + " WHERE CAST(app_meta.value AS INTEGER)<?"
      + " RETURNING CAST(value AS INTEGER) used",
  );
  const pruneBudgets = database.prepare("DELETE FROM app_meta WHERE key GLOB ? AND key<>?");

  let started = false;
  let stopped = false;
  let draining = false;
  let timer = null;
  let timerDueAt = 0;
  let activeController = null;
  let drainPromise = null;

  const atomic = (work) => {
    database.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      database.exec("COMMIT");
      return result;
    } catch (error) {
      try { database.exec("ROLLBACK"); }
      catch { /* architecture: allow-empty-catch -- preserve the queue transaction failure */ }
      throw error;
    }
  };

  const configuredProviders = () => providerConfiguration(env);

  const hasProvider = () => {
    const config = configuredProviders();
    return enabledByEnvironment(env) && !!(config.ticketmasterKey || config.bandsintownAppId);
  };

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    timerDueAt = 0;
  };

  const recover = (at) => recoverExpired.run(at, at, at).changes;

  const reserveBudget = (at) => {
    const key = budgetKey(at);
    pruneBudgets.run(BUDGET_PREFIX + "*", key);
    return !!readBudget.get(key, options.globalHourlyLimit);
  };

  const claimDue = (at) => atomic(() => {
    recover(at);
    const candidate = nextCandidate.get(at);
    if (!candidate) return { status: "empty" };
    if (!reserveBudget(at)) {
      const retryAt = nextGlobalBucket(at) + 1;
      deferRow.run(retryAt, at, candidate.artist_key);
      return { status: "budget", retryAt };
    }
    const claimToken = optionalLine(claimTokenFactory(), 100);
    if (!claimToken) throw new Error("claim token factory returned an invalid token");
    const claimed = claimRow.run(
      claimToken,
      at,
      at + options.runningLeaseMs,
      at,
      candidate.artist_key,
      at,
    ).changes === 1;
    return claimed
      ? {
        status: "claimed",
        row: {
          ...candidate,
          status: "running",
          claim_token: claimToken,
          attempted_at: at,
          not_before: at + options.runningLeaseMs,
          attempt_count: Number(candidate.attempt_count) + 1,
        },
      }
      : { status: "contended" };
  });

  const scheduleNext = (minimumDelay = 0) => {
    if (!autoSchedule || !started || stopped || draining || !hasProvider()) return;
    const at = clock();
    recover(at);
    const due = Number(nextDue.get()?.due_at);
    if (!Number.isFinite(due)) {
      clearTimer();
      return;
    }
    const requestedDue = Math.max(at + Math.max(0, minimumDelay), due);
    if (timer && timerDueAt <= requestedDue) return;
    clearTimer();
    timerDueAt = requestedDue;
    timer = setTimeout(() => {
      timer = null;
      timerDueAt = 0;
      void drain();
    }, Math.max(0, requestedDue - at));
    timer.unref?.();
  };

  const activeClaim = (claimedRow, finishedAt) => {
    const current = queueByKey.get(claimedRow.artist_key);
    if (!current
      || current.status !== "running"
      || current.claim_token !== claimedRow.claim_token
      || Number(current.attempted_at) !== Number(claimedRow.attempted_at)
      || Number(current.not_before) <= finishedAt) return null;
    return current;
  };

  const retryTiming = (current, category, failedAt) => {
    const exhausted = Number(current.attempt_count) >= options.maxAttempts;
    const exponential = options.failureCooldownMs * (2 ** Math.max(0, Number(current.attempt_count) - 1));
    const categoryFloor = category === "provider_rate_limited" ? HOUR : 0;
    return {
      exhausted,
      retryAt: failedAt + (exhausted
        ? DAY
        : Math.max(categoryFloor, Math.min(12 * HOUR, exponential))),
    };
  };

  const writeSettlement = (claimedRow, finishedAt, state) => {
    const changed = settleRow.run({
      status: state.status,
      not_before: state.notBefore,
      succeeded_at: state.succeededAt,
      attempt_count: state.attemptCount,
      ticketmaster_attraction_id: state.ticketmasterAttractionId,
      ticketmaster_scan_cursor_date: state.cursorDate,
      ticketmaster_scan_horizon_date: state.horizonDate,
      ticketmaster_window_days: state.windowDays,
      ticketmaster_coverage_limited: state.coverageLimited ? 1 : 0,
      ticketmaster_scan_completed: state.ticketmasterCompleted ? 1 : 0,
      bandsintown_refresh_completed: state.bandsintownCompleted ? 1 : 0,
      last_error_code: state.errorCode,
      updated_at: finishedAt,
      artist_key: claimedRow.artist_key,
      claim_token: claimedRow.claim_token,
      attempted_at: claimedRow.attempted_at,
      finished_at: finishedAt,
    }).changes;
    if (changed !== 1) throw new Error("exact artist refresh claim changed during settlement");
  };

  const settleRefreshResult = (claimedRow, result, finishedAt, scanWindow, config) => atomic(() => {
    const current = activeClaim(claimedRow, finishedAt);
    if (!current) return { status: "stale_claim", artistKey: claimedRow.artist_key };

    const rows = Array.isArray(result?.rows) ? result.rows : [];
    persistRows(rows, finishedAt);

    const tmReport = result?.ticketmaster?.attempted ? result.ticketmaster : null;
    const bitReport = result?.bandsintown?.attempted ? result.bandsintown : null;
    if (tmReport?.complete && scanWindow) {
      reconcileExactArtistTicketmasterWindow(database, {
        artistKey: claimedRow.artist_key,
        scanStartDate: scanWindow.cursorDate,
        scanEndDate: scanWindow.endDate,
        seenSince: finishedAt,
      });
    }
    let cursorDate = validDateKey(current.ticketmaster_scan_cursor_date)
      || scanWindow?.cursorDate
      || null;
    let horizonDate = validDateKey(current.ticketmaster_scan_horizon_date)
      || scanWindow?.horizonDate
      || null;
    let windowDays = Number(current.ticketmaster_window_days) || scanWindow?.windowDays || null;
    let coverageLimited = current.ticketmaster_coverage_limited === 1;
    let ticketmasterCompleted = !config.ticketmasterKey || current.ticketmaster_scan_completed === 1;
    let bandsintownCompleted = !config.bandsintownAppId || current.bandsintown_refresh_completed === 1;

    if (bitReport?.complete) bandsintownCompleted = true;
    if (tmReport && scanWindow) {
      cursorDate = scanWindow.cursorDate;
      horizonDate = scanWindow.horizonDate;
      windowDays = scanWindow.windowDays;
      if (tmReport.complete) {
        const nextCursor = addDateDays(scanWindow.endDate, 1);
        if (nextCursor > scanWindow.horizonDate) {
          ticketmasterCompleted = true;
          cursorDate = null;
          horizonDate = null;
          windowDays = null;
        } else {
          cursorDate = nextCursor;
          // Dense slices reduce the durable window. Once a slice becomes fully
          // pageable, grow cautiously toward the configured window so one busy
          // date cannot pin the remainder of a three-year scan to one-day jobs.
          windowDays = Math.min(
            options.ticketmasterWindowDays,
            Math.max(scanWindow.windowDays, scanWindow.windowDays * 2),
          );
        }
      } else if (tmReport.limited) {
        if (scanWindow.windowDays > 1) {
          windowDays = Math.max(1, Math.floor(scanWindow.windowDays / 2));
        } else {
          // Only an irreducible one-day provider cap creates a real coverage
          // gap. Merely narrowing a larger window is convergence, not loss.
          coverageLimited = true;
          const nextCursor = addDateDays(scanWindow.endDate, 1);
          if (nextCursor > scanWindow.horizonDate) {
            ticketmasterCompleted = true;
            cursorDate = null;
            horizonDate = null;
            windowDays = null;
          } else {
            cursorDate = nextCursor;
          }
        }
      }
    }

    // Test and maintenance callers with the legacy result shape represent one
    // complete refresh. Production emits explicit per-provider reports.
    if (!result?.ticketmaster && !result?.bandsintown && result?.complete === true) {
      ticketmasterCompleted = true;
      bandsintownCompleted = true;
      cursorDate = null;
      horizonDate = null;
      windowDays = null;
    }

    const cycleComplete = ticketmasterCompleted && bandsintownCompleted;
    const errorCategory = result?.errorCategory
      || tmReport?.errorCategory
      || bitReport?.errorCategory
      || (result?.complete === false && !tmReport?.limited ? "provider_refresh_failed" : null);
    const hasProviderError = !!errorCategory
      && errorCategory !== "ticketmaster_coverage_limited";

    const state = {
      ticketmasterAttractionId: attractionValueAfterResult(current, result),
      cursorDate,
      horizonDate,
      windowDays,
      coverageLimited,
      ticketmasterCompleted,
      bandsintownCompleted,
      succeededAt: current.succeeded_at,
      errorCode: null,
      status: "pending",
      notBefore: finishedAt + Math.max(1, options.interJobDelayMs),
      attemptCount: 0,
    };

    let outcome;
    if (cycleComplete) {
      state.status = "cooldown";
      state.notBefore = finishedAt + options.successCooldownMs;
      state.succeededAt = coverageLimited ? current.succeeded_at : finishedAt;
      state.errorCode = coverageLimited ? "ticketmaster_coverage_limited" : null;
      outcome = coverageLimited ? "coverage_limited" : "completed";
    } else if (hasProviderError) {
      const timing = retryTiming(current, errorCategory, finishedAt);
      state.status = timing.exhausted ? "cooldown" : "pending";
      state.notBefore = timing.retryAt;
      state.errorCode = errorCategory;
      state.attemptCount = Number(current.attempt_count);
      outcome = timing.exhausted ? "exhausted" : "retry";
    } else {
      state.errorCode = tmReport?.limited ? "ticketmaster_coverage_limited" : null;
      outcome = tmReport?.limited ? "window_narrowed" : "continued";
    }

    writeSettlement(claimedRow, finishedAt, state);
    return {
      status: outcome,
      artistKey: claimedRow.artist_key,
      rows: rows.length,
      retryAt: state.notBefore,
    };
  });

  const settleThrownFailure = (claimedRow, error, failedAt, signal) => atomic(() => {
    const current = activeClaim(claimedRow, failedAt);
    if (!current) return { status: "stale_claim", artistKey: claimedRow.artist_key };
    const category = providerFailureCode(error, signal);
    const timing = retryTiming(current, category, failedAt);
    writeSettlement(claimedRow, failedAt, {
      status: timing.exhausted ? "cooldown" : "pending",
      notBefore: timing.retryAt,
      succeededAt: current.succeeded_at,
      attemptCount: Number(current.attempt_count),
      ticketmasterAttractionId: providerIdentifier(current.ticketmaster_attraction_id) || null,
      cursorDate: validDateKey(current.ticketmaster_scan_cursor_date) || null,
      horizonDate: validDateKey(current.ticketmaster_scan_horizon_date) || null,
      windowDays: Number(current.ticketmaster_window_days) || null,
      coverageLimited: current.ticketmaster_coverage_limited === 1,
      ticketmasterCompleted: current.ticketmaster_scan_completed === 1,
      bandsintownCompleted: current.bandsintown_refresh_completed === 1,
      errorCode: category,
    });
    return {
      status: timing.exhausted ? "exhausted" : "retry",
      artistKey: claimedRow.artist_key,
      retryAt: timing.retryAt,
      errorCategory: category,
    };
  });

  const runDueOnce = async () => {
    if (stopped) return { status: "stopped" };
    if (!hasProvider()) return { status: "disabled" };
    const claim = claimDue(clock());
    if (claim.status !== "claimed") return claim;

    const controller = new AbortController();
    activeController = controller;
    const row = claim.row;
    const config = configuredProviders();
    const scanWindow = config.ticketmasterKey && row.ticketmaster_scan_completed !== 1
      ? ticketmasterDemandScanWindow(row, clock(), {
        initialWindowDays: options.ticketmasterWindowDays,
      })
      : null;
    try {
      const result = await refreshArtist({
        artistKey: row.artist_key,
        artistName: row.name,
        ticketmasterAttractionId: providerIdentifier(row.ticketmaster_attraction_id) || null,
        env,
        signal: controller.signal,
        at: clock(),
        includeTicketmaster: !!scanWindow,
        includeBandsintown: !!config.bandsintownAppId
          && row.bandsintown_refresh_completed !== 1,
        startEndDateTime: scanWindow?.startEndDateTime,
        scanStartDate: scanWindow?.cursorDate,
        scanEndDate: scanWindow?.endDate,
      });
      const outcome = settleRefreshResult(row, result, clock(), scanWindow, config);
      if (outcome.status === "retry" || outcome.status === "exhausted") {
        logger.error?.(
          "[pit] exact artist tour-date refresh failed safely category="
            + (result?.errorCategory || "provider_refresh_failed"),
        );
      }
      return outcome;
    } catch (error) {
      const outcome = settleThrownFailure(row, error, clock(), controller.signal);
      if (outcome.status !== "stale_claim") {
        logger.error?.(
          "[pit] exact artist tour-date refresh failed safely category="
            + providerFailureCode(error, controller.signal),
        );
      }
      return outcome;
    } finally {
      if (activeController === controller) activeController = null;
    }
  };

  const drain = () => {
    if (draining || stopped || !started || !hasProvider()) {
      return drainPromise || Promise.resolve({ status: "idle" });
    }
    clearTimer();
    draining = true;
    drainPromise = runJob(runDueOnce)
      .catch((error) => {
        logger.error?.(
          "[pit] exact artist refresh queue failed safely category=" + providerFailureCode(error),
        );
        return { status: "failed" };
      })
      .finally(() => {
        draining = false;
        drainPromise = null;
        scheduleNext(options.interJobDelayMs);
      });
    return drainPromise;
  };

  const enqueue = ({ artistKey, authenticated = false } = {}) => {
    if (!authenticated) return { queued: false, reason: "authentication_required" };
    if (stopped) return { queued: false, reason: "stopped" };
    if (!hasProvider()) return { queued: false, reason: "disabled" };
    const key = optionalLine(artistKey, 200).toLocaleLowerCase("en");
    const catalog = key ? catalogByKey.get(key) : null;
    if (!catalog || catalog.norm !== key) return { queued: false, reason: "unknown_artist" };
    const at = clock();
    const result = atomic(() => {
      pruneCooldowns.run(at - options.retentionMs);
      const existing = queueByKey.get(key);
      if (existing?.status === "pending" || existing?.status === "running") {
        return { queued: false, reason: "already_queued" };
      }
      if (existing && Number(existing.not_before) > at) {
        return { queued: false, reason: "cooldown", retryAt: Number(existing.not_before) };
      }
      if (Number(activeQueueCount.get().count) >= options.queueLimit) {
        return { queued: false, reason: "queue_full" };
      }
      enqueueRow.run(key, at, at, at);
      return { queued: true, reason: "queued" };
    });
    if (result.queued) scheduleNext();
    return result;
  };

  const start = () => {
    if (started || stopped) return false;
    started = true;
    if (hasProvider()) scheduleNext();
    return true;
  };

  const stop = ({ abortActive = true } = {}) => {
    stopped = true;
    clearTimer();
    if (abortActive) activeController?.abort(new DOMException("Server stopping", "AbortError"));
    return drainPromise || Promise.resolve();
  };

  return Object.freeze({
    enqueue,
    start,
    stop,
    runDueOnce,
  });
}

const artistTourDateDemandRefresh = createArtistTourDateDemandRefreshService({
  database: db,
});

export function enqueueArtistTourDateDemandRefresh(request) {
  return artistTourDateDemandRefresh.enqueue(request);
}

export function startArtistTourDateDemandRefresh() {
  return artistTourDateDemandRefresh.start();
}

export function stopArtistTourDateDemandRefresh(options) {
  return artistTourDateDemandRefresh.stop(options);
}
