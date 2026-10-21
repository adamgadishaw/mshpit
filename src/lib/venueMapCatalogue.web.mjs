import { VENUE_MAP_PAGE_TIMEOUT_MS as PAGE_TIMEOUT_MS, venueMapFailure as failure, venueMapAbortReason as abortReason,
  readVenueMapPage, loadVenueMapPublicPages } from "../domain/venueMapPublicPages.mjs";
const LOCAL_REFRESH_BODY_TIMEOUT_MS = 95000;
const text = value => typeof value === "string" ? value.trim() : "";

function loopbackPreview(location) {
  return location?.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(location?.hostname);
}

async function readPage(url, { signal, request, timeoutMs, localRefresh = false, localRefreshTimeoutMs = LOCAL_REFRESH_BODY_TIMEOUT_MS, onRefresh }) {
  return readVenueMapPage(url, { signal, request, timeoutMs, maximumTimeoutMs: localRefresh ? LOCAL_REFRESH_BODY_TIMEOUT_MS : PAGE_TIMEOUT_MS,
    onResponse: response => {
        // Only the opt-in loopback review server can extend the response-body
        // wait while it completes its bounded public refresh. Ordinary public
        // requests keep the existing 12-second deadline.
        if (localRefresh && response.headers?.get?.("X-Mshpit-Local-Refresh") === "1") {
          onRefresh?.();
          return Math.min(Math.max(Number(localRefreshTimeoutMs) || LOCAL_REFRESH_BODY_TIMEOUT_MS, 1), LOCAL_REFRESH_BODY_TIMEOUT_MS);
        }
        return null;
    } });
}

function compactPayload(value) {
  if (value?.venueMapCatalogue !== true || value.complete !== true) throw failure("The compact venue catalogue is unavailable. Existing venue cards remain available.", "VENUE_MAP_COMPACT_UNAVAILABLE");
  if (!Array.isArray(value.tourDates) || value.tourDates.some(row => !row || typeof row !== "object" || Array.isArray(row) || !text(row.id))
    || !Number.isSafeInteger(value.eventCount) || value.eventCount < value.tourDates.length
    || !Number.isSafeInteger(value.venueCount) || value.venueCount < 0 || value.venueCount > value.tourDates.length
    || !Number.isSafeInteger(value.pages) || value.pages < 1 || !Number.isFinite(Date.parse(value.fetchedAt))) throw failure("The compact venue catalogue was incomplete or invalid.", "VENUE_MAP_SCHEMA");
  return value;
}

/** Default UI uses only the compact projection. Raw paging requires explicit opt-in. */
export async function loadVenueMapEvents({ signal, onPage, request = fetch, timeoutMs = PAGE_TIMEOUT_MS, compact = true,
  refresh = false, previewLocation = globalThis.location, localRefreshTimeoutMs = LOCAL_REFRESH_BODY_TIMEOUT_MS, onRefresh } = {}) {
  const deadline = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, PAGE_TIMEOUT_MS) : PAGE_TIMEOUT_MS;
  if (!compact) return loadVenueMapPublicPages({ signal, onPage, readPage: path => readPage(path, { signal, request, timeoutMs: deadline }) });
  const rows = [];
  let pages = 0;
  try {
    if (compact) {
      let payload;
      const localRefresh = loopbackPreview(previewLocation);
      const query = new URLSearchParams({ scope: "all-upcoming", limit: "500", view: "venue-map" });
      if (localRefresh && refresh) query.set("refresh", "1");
      try { payload = await readPage(`/api/tourdates?${query}`, { signal, request, timeoutMs: deadline, localRefresh, localRefreshTimeoutMs, onRefresh }); }
      catch (error) {
        if ([400, 404].includes(error.status)) throw failure("The compact venue catalogue is unavailable. Existing venue cards remain available.", "VENUE_MAP_COMPACT_UNAVAILABLE");
        throw error;
      }
      const page = compactPayload(payload);
      if (signal?.aborted) throw abortReason(signal);
      // Compact rows represent distinct coordinate/locality witnesses. Even a
      // repeated event id must not discard contradictory evidence here.
      rows.push(...page.tourDates);
      pages = page.pages;
      onPage?.({ tourDates: rows.slice(), pages, loaded: page.eventCount, nextCursor: null, complete: true, compact: true, fetchedAt: page.fetchedAt });
      return { tourDates: rows, pages, complete: true, compact: true, eventCount: page.eventCount, venueCount: page.venueCount, fetchedAt: page.fetchedAt,
        localRefresh: page.localRefresh === true, refreshed: page.refreshed === true, refreshFailed: page.refreshFailed === true };
    }
  } catch (cause) {
    const error = cause instanceof Error ? cause : failure("The venue catalogue could not finish loading.", "VENUE_MAP_NETWORK");
    error.partialRows = rows.slice(); error.pages = pages; error.compact = compact;
    throw error;
  }
}

/** Preserve cards on a failed refresh while never granting expired coordinates
 * a new clock. Kept pure so expiry and failure recovery have direct regressions. */
export function venueMapFeedResultState(value, previous = {}, now = Date.now()) {
  const previousEvents = previous.remoteEvents || [];
  const failed = value?.refreshFailed === true;
  const fetchedAt = failed && previousEvents.length ? previous.providerFetchedAt : value?.fetchedAt;
  const retrieved = Date.parse(fetchedAt), age = now - retrieved;
  const fresh = Number.isFinite(age) && age >= 0 && age < 3600000;
  return {
    remoteEvents: failed && previousEvents.length ? previousEvents : value?.tourDates || [],
    providerFetchedAt: fresh ? fetchedAt : null,
    feedStatus: failed ? "error" : fresh ? "ready" : "stale",
    feedLoaded: value?.eventCount || 0,
  };
}
