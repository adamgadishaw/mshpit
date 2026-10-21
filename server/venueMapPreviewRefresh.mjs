import { loadVenueMapPublicPages, readVenueMapPage } from "../src/domain/venueMapPublicPages.mjs";
import { compactVenueMapEvents, venueMapPreviewEnabled } from "./venueMapCatalogueProjection.mjs";

export const PUBLIC_CATALOGUE_ORIGIN = "https://www.mshpit.com";
export const LOCAL_REFRESH_TIMEOUT_MS = 90000;
const SOURCE_MAX_AGE_MS = 3600000; // Existing conservative session policy, not a provider contract term.
const abortError = () => Object.assign(new Error("Local venue refresh was cancelled."), { name: "AbortError", code: "VENUE_MAP_ABORTED" });
const reason = signal => signal?.reason instanceof Error ? signal.reason : abortError();

export function venueMapLiveRefreshEnabled(env = process.env) {
  return venueMapPreviewEnabled(env) && env?.MSHPIT_MAPLIBRE_CATALOGUE_PREVIEW === "1" && env?.MSHPIT_MAPLIBRE_LIVE_REFRESH === "1";
}

/** Local review only. A public source capture is replaced only after every page
 * completes and its versioned receipt is saved. No timers start work on their own.
 * capturedAt is public-catalogue retrieval time, not an upstream ingestion claim. */
export function createVenueMapPreviewRefresh({ snapshot, request = fetch, saveSnapshot = async () => {}, now = Date.now,
  timeoutMs = LOCAL_REFRESH_TIMEOUT_MS, pageTimeoutMs = 12000 } = {}) {
  if (!snapshot?.complete || !Array.isArray(snapshot.tourDates)) throw new TypeError("A complete original public capture is required.");
  let current = snapshot;
  let compact = compactVenueMapEvents(current.tourDates, { fetchedAt: current.capturedAt, pages: current.pages });
  let inflight = null;
  const deadline = Math.min(Math.max(Number(timeoutMs) || LOCAL_REFRESH_TIMEOUT_MS, 1), LOCAL_REFRESH_TIMEOUT_MS);
  const fresh = () => { const age = now() - Date.parse(current.capturedAt); return Number.isFinite(age) && age >= 0 && age < SOURCE_MAX_AGE_MS; };
  const cached = extra => ({ ...compact, localRefresh: true, ...extra });

  function start() {
    const controller = new AbortController(), startedAt = now();
    const operation = { controller, waiters: 0, promise: null };
    const timer = setTimeout(() => controller.abort(Object.assign(new Error("The local public catalogue refresh exceeded 90 seconds."), { name: "TimeoutError", code: "VENUE_MAP_REFRESH_TIMEOUT" })), deadline);
    operation.promise = (async () => {
      try {
        const value = await loadVenueMapPublicPages({ signal: controller.signal, now,
          readPage: path => readVenueMapPage(new URL(path, PUBLIC_CATALOGUE_ORIGIN).href,
            { signal: controller.signal, request, timeoutMs: Math.min(Math.max(Number(pageTimeoutMs) || 12000, 1), 12000) }) });
        if (controller.signal.aborted) throw reason(controller.signal);
        const capturedAt = new Date(now()).toISOString();
        const next = { tourDates: value.tourDates, complete: true, pages: value.pages, rows: value.tourDates.length, capturedAt,
          sourceOrigin: PUBLIC_CATALOGUE_ORIGIN, sourcePath: "/api/tourdates?scope=all-upcoming&limit=500", publicCredentials: "omit" };
        const nextCompact = compactVenueMapEvents(next.tourDates, { fetchedAt: capturedAt, pages: value.pages });
        const receipt = { sourceOrigin: PUBLIC_CATALOGUE_ORIGIN, sourcePath: next.sourcePath, publicCredentials: "omit", complete: true,
          catalogueRetrievedAt: capturedAt, capturedAt, startedAt: new Date(startedAt).toISOString(), durationMs: now() - startedAt,
          pages: value.pages, requests: value.pages, rows: next.rows, venueCount: nextCompact.venueCount, witnessRows: nextCompact.tourDates.length,
          sourceBytes: Buffer.byteLength(JSON.stringify(next)), compactBytes: Buffer.byteLength(JSON.stringify(nextCompact)),
          timestampMeaning: "Completed retrieval from the public MSHPIT catalogue; not a claim of a new upstream provider ingestion." };
        await saveSnapshot(next, receipt);
        if (controller.signal.aborted) throw reason(controller.signal);
        current = next; compact = nextCompact;
        return cached({ refreshed: true, refreshFailed: false });
      } finally {
        clearTimeout(timer);
        if (inflight === operation) inflight = null;
      }
    })();
    // Cancellation may release the final waiter before the upstream rejects.
    // Always observe that eventual rejection without keeping a background job alive.
    // architecture: allow-empty-catch -- every active waiter receives errors; observe cancellation after the final waiter disconnects.
    operation.promise.catch(() => {});
    inflight = operation;
    return operation;
  }

  async function get({ signal, refresh = false } = {}) {
    if (signal?.aborted) throw reason(signal);
    if (!refresh && fresh()) return cached({ refreshed: false, refreshFailed: false });
    const operation = inflight && !inflight.controller.signal.aborted ? inflight : start();
    operation.waiters += 1;
    let rejectAborted;
    const cancelled = new Promise((resolve, reject) => { rejectAborted = () => reject(reason(signal)); });
    signal?.addEventListener("abort", rejectAborted, { once: true });
    if (signal?.aborted) rejectAborted();
    try {
      return await Promise.race([operation.promise, cancelled]);
    } catch (error) {
      if (signal?.aborted) throw reason(signal);
      // Never replace a complete capture with a partial scan or renew its clock.
      return cached({ refreshed: false, refreshFailed: true, refreshErrorCode: error?.code || "VENUE_MAP_REFRESH_FAILED",
        refreshNotice: "Public source refresh failed. Previously loaded venue cards remain available; expired locations stay off the map. Retry to try again." });
    } finally {
      signal?.removeEventListener("abort", rejectAborted);
      operation.waiters -= 1;
      if (!operation.waiters && inflight === operation) operation.controller.abort(abortError());
    }
  }

  return { get, snapshot: () => current };
}
