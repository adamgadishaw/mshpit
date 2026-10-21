// Platform-neutral orchestration shared by the browser and local preview.
// Callers inject the public request/page reader; no origins or credentials live here.
export const VENUE_MAP_PAGE_TIMEOUT_MS = 12000;
const text = value => typeof value === "string" ? value.trim() : "";

export function venueMapFailure(message, code, name = "Error") {
  const error = new Error(message); error.code = code; error.name = name; return error;
}

export function venueMapAbortReason(signal) {
  return signal?.reason instanceof Error ? signal.reason : venueMapFailure("Venue loading was cancelled.", "VENUE_MAP_ABORTED", "AbortError");
}

export async function readVenueMapPage(url, { signal, request, timeoutMs = VENUE_MAP_PAGE_TIMEOUT_MS,
  maximumTimeoutMs = VENUE_MAP_PAGE_TIMEOUT_MS, onResponse } = {}) {
  if (signal?.aborted) throw venueMapAbortReason(signal);
  if (typeof request !== "function") throw new TypeError("An injected public request is required.");
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(venueMapAbortReason(signal));
  signal?.addEventListener("abort", forwardAbort, { once: true });
  const expired = () => controller.abort(venueMapFailure("A venue catalogue page timed out. Loaded venues remain available.", "VENUE_MAP_TIMEOUT", "TimeoutError"));
  let timer = setTimeout(expired, Math.min(timeoutMs, maximumTimeoutMs));
  let rejectAborted;
  const aborted = new Promise((resolve, reject) => { rejectAborted = () => reject(venueMapAbortReason(controller.signal)); });
  controller.signal.addEventListener("abort", rejectAborted, { once: true });
  try {
    return await Promise.race([
      (async () => {
        const response = await request(url, { method: "GET", credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", headers: { Accept: "application/json" }, signal: controller.signal });
        if (controller.signal.aborted) throw venueMapAbortReason(controller.signal);
        if (!response?.ok) {
          const error = venueMapFailure(`A venue catalogue page could not load (HTTP ${Number(response?.status) || 0}).`, "VENUE_MAP_HTTP");
          error.status = Number(response?.status) || 0; throw error;
        }
        const bodyTimeout = onResponse?.(response);
        if (Number.isFinite(bodyTimeout) && bodyTimeout > 0) {
          clearTimeout(timer); timer = setTimeout(expired, Math.min(bodyTimeout, maximumTimeoutMs));
        }
        const payload = await response.json();
        if (controller.signal.aborted) throw venueMapAbortReason(controller.signal);
        return payload;
      })(), aborted,
    ]);
  } finally {
    clearTimeout(timer); signal?.removeEventListener("abort", forwardAbort);
    controller.signal.removeEventListener("abort", rejectAborted);
  }
}

function publicPage(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.tourDates)
    || !Object.hasOwn(value, "nextCursor") || (value.nextCursor !== null && (typeof value.nextCursor !== "string" || !value.nextCursor || value.nextCursor.length > 1000 || !/^[A-Za-z0-9_-]+$/.test(value.nextCursor)))
    || value.tourDates.some(row => !row || typeof row !== "object" || Array.isArray(row) || !text(row.id))) {
    throw venueMapFailure("The venue catalogue page was incomplete or invalid. Loaded venues remain available.", "VENUE_MAP_SCHEMA");
  }
  return value;
}

/** Sequential complete public cursor scan, with no arbitrary page or row cap. */
export async function loadVenueMapPublicPages({ signal, onPage, readPage, now = Date.now } = {}) {
  if (typeof readPage !== "function") throw new TypeError("An injected public page reader is required.");
  const rows = [], identities = new Set(), cursors = new Set();
  let cursor = null, pages = 0;
  try {
    while (true) {
      if (signal?.aborted) throw venueMapAbortReason(signal);
      const query = new URLSearchParams({ scope: "all-upcoming", limit: "500" });
      if (cursor) query.set("after", cursor);
      const page = publicPage(await readPage(`/api/tourdates?${query}`));
      if (signal?.aborted) throw venueMapAbortReason(signal);
      pages += 1;
      let added = 0;
      for (const row of page.tourDates) {
        if (identities.has(row.id)) continue;
        identities.add(row.id); rows.push(row); added += 1;
      }
      const complete = page.nextCursor === null;
      onPage?.({ tourDates: rows.slice(), pages, loaded: rows.length, nextCursor: page.nextCursor, complete });
      if (complete) return { tourDates: rows, pages, complete: true, compact: false, eventCount: rows.length, fetchedAt: new Date(now()).toISOString() };
      if (page.nextCursor === cursor || cursors.has(page.nextCursor)) throw venueMapFailure("The venue catalogue repeated a page cursor. Loaded venues remain available.", "VENUE_MAP_CURSOR");
      if (!added && page.tourDates.length) throw venueMapFailure("The venue catalogue made no progress. Loaded venues remain available.", "VENUE_MAP_NO_PROGRESS");
      cursors.add(page.nextCursor); cursor = page.nextCursor;
    }
  } catch (cause) {
    const error = cause instanceof Error ? cause : venueMapFailure("The venue catalogue could not finish loading.", "VENUE_MAP_NETWORK");
    error.partialRows = rows.slice(); error.pages = pages; error.compact = false; throw error;
  }
}
