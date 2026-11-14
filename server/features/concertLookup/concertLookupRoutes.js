import { activeAccountSql } from "../../accountVisibility.js";
import { visibleTourDateRowsFrom } from "../../tourDateVisibilityQuery.js";
import { inPersonReviewSql } from "../../onlineReviews.js";
import { archiveShowKeyForPost } from "../artistArchive/postArchiveIdentity.js";
import { ticketmasterEventSearchUrl, ticketmasterRows, ticketmasterRequestDelayMs } from "../../tourdates.js";
import { readBoundedJsonResponse } from "../../boundedJsonResponse.js";
import { concertCityMatches, concertLookupDate, mergeConcertMatches } from "../../../src/domain/concertLookup.mjs";
import { publicTourDateVenueName } from "../../publicTourDateVenueProjection.js";

// Read-only lookup: no scanner, calendar or review rows are written by search.
// This cache contains only public provider facts, never member history.
export function concertLookupRoutes({ database, ApiError, requireUser, rateLimit, clean,
  fetchImpl = (...args) => fetch(...args), apiKey = () => process.env.TICKETMASTER_KEY, now = Date.now }) {
  const providerCache = new Map();
  let activeProviderRequests = 0;
  const recentProviderCalls = [];
  let providerRetryAt = 0;
  const history = database.prepare(`SELECT p.artist,p.artist_key,p.venue,p.venue_key,p.city,p.date,p.tour
    FROM posts p JOIN users u ON u.id=p.user_id
    WHERE p.date=@date AND (p.artist_key=@artistKey OR (p.artist_key IS NULL AND LOWER(p.artist)=LOWER(@artist)))
      AND p.removed=0 AND ${inPersonReviewSql("p")} AND ${activeAccountSql("u")}
      AND (u.id=@viewer OR COALESCE(u.profile_audience,'everyone') IN ('everyone','members'))
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
        (b.blocker_id=@viewer AND b.blocked_id=u.id) OR (b.blocker_id=u.id AND b.blocked_id=@viewer))
    GROUP BY p.artist,p.artist_key,p.venue,p.venue_key,p.city,p.date,p.tour
    ORDER BY p.venue,p.city,p.tour LIMIT 201`);
  const project = (row, artist, artistKey, source) => ({
    id: row.id || `${archiveShowKeyForPost(row)}|${row.city}`, eventId: row.id || null,
    archiveShowKey: archiveShowKeyForPost({ ...row, artist_key: artistKey }),
    artist, artistKey, venue: publicTourDateVenueName(row) || row.venue || "",
    city: row.place || row.city || "", date: row.date, tour: row.tour_name || row.tour || "",
    officialEventName: row.event_name || "", startLocalTime: row.start_local_time || "",
    source, providerEventId: row.provider_event_id || null,
  });
  return { "GET /api/concerts/lookup": async ctx => {
    const user = requireUser(ctx);
    ctx.setHeader?.("Cache-Control", "private, no-store");
    rateLimit(ctx, "concert-lookup", 120, 10 * 60 * 1000);
    const artist = clean(ctx.query?.artist, { max: 80 });
    const artistKey = clean(ctx.query?.artistKey, { max: 120 }) || null;
    const city = clean(ctx.query?.city, { max: 240 });
    const date = concertLookupDate(ctx.query?.date);
    const source = ctx.query?.source || "catalog";
    if (!artist || !city || !date || !["catalog", "ticketmaster"].includes(source)) {
      throw new ApiError(400, "Choose an artist, city and calendar date to find a concert.", "VALIDATION_FAILED");
    }
    if (artistKey) {
      const canonical = database.prepare("SELECT name FROM artists WHERE norm=?").get(artistKey);
      if (!canonical || canonical.name.toLocaleLowerCase() !== artist.toLocaleLowerCase()) {
        throw new ApiError(400, "Choose the artist again before finding concerts.", "VALIDATION_FAILED");
      }
    }
    if (source === "catalog") {
      // Reuse current ownership/visibility rules, excluding unreleased facts
      // even when the caller is the author or an administrator.
      const rawEvents = visibleTourDateRowsFrom(database, { ...user, role: "fan" }, { artist, date, limit: 201, at: now() });
      const events = rawEvents.filter(row => row.release_at <= now()
        && (!row.artist_key || !artistKey || row.artist_key === artistKey)
        && !["cancelled", "canceled", "postponed"].includes(row.event_status));
      const reviews = history.all({ date, artist, artistKey, viewer: user.id });
      const matches = mergeConcertMatches(events.map(row => project(row, artist, artistKey, "catalog")),
        reviews.map(row => project(row, artist, artistKey, "community")))
        .filter(row => row.venue && concertCityMatches(row.city, city));
      return { matches: matches.slice(0, 50), complete: rawEvents.length < 201 && reviews.length < 201 && matches.length <= 50 };
    }
    rateLimit(ctx, "concert-lookup-ticketmaster", 40, 60 * 60 * 1000);
    if (!apiKey()) return { matches: [], status: "unavailable", complete: false };
    const cacheKey = JSON.stringify([artist, artistKey, city, date]);
    const cached = providerCache.get(cacheKey);
    if (cached && cached.expires > now()) return cached.result;
    while (recentProviderCalls.length && recentProviderCalls[0] <= now() - 60 * 60_000) recentProviderCalls.shift();
    // An additional conservative application budget, NOT an assertion about
    // the account's provider quota. Reuse configured scanner spacing and honor
    // provider throttling; lookup never retries a provider call automatically.
    const spacing = Math.max(5000, ticketmasterRequestDelayMs(process.env.TOURDATE_REQUEST_DELAY_MS));
    if (activeProviderRequests >= 1 || recentProviderCalls.length >= 12 || now() < providerRetryAt
      || (recentProviderCalls.length && now() - recentProviderCalls.at(-1) < spacing)) {
      return { matches: [], status: "busy", complete: false };
    }
    recentProviderCalls.push(now());
    activeProviderRequests += 1;
    const controller = new AbortController();
    const abort = () => controller.abort();
    ctx.signal?.addEventListener("abort", abort, { once: true });
    if (ctx.signal?.aborted) controller.abort();
    const timer = setTimeout(abort, 6000);
    try {
      const url = new URL(ticketmasterEventSearchUrl({ apiKey: apiKey(), keyword: artist, city: city.split(",")[0].trim(), size: 100 }));
      url.searchParams.set("localStartDateTime", `${date}T00:00:00,${date}T23:59:59`);
      const response = await fetchImpl(url.toString(), { signal: controller.signal });
      if (response.status === 429) {
        const retry = response.headers?.get?.("retry-after");
        const requestedAt = /^\d+$/.test(retry || "") ? now() + Number(retry) * 1000 : Date.parse(retry || "");
        providerRetryAt = Math.max(now() + 15 * 60_000, Number.isFinite(requestedAt) ? requestedAt : 0);
      }
      if (!response.ok) throw new Error("Provider unavailable");
      const data = await readBoundedJsonResponse(response, { signal: controller.signal, maxBytes: 2 * 1024 * 1024 });
      const matches = mergeConcertMatches(ticketmasterRows(data, { requestedArtist: artist })
        .filter(row => row.date === date && concertCityMatches(row.place, city)
          && !["cancelled", "canceled", "postponed"].includes(row.event_status))
        .map(row => project(row, artist, artistKey, "ticketmaster")));
      const result = { matches: matches.slice(0, 50), status: "ready", complete: Number(data?.page?.totalPages || 0) <= 1 && matches.length <= 50 };
      if (providerCache.size >= 128) providerCache.delete(providerCache.keys().next().value);
      providerCache.set(cacheKey, { expires: now() + 5 * 60_000, result });
      return result;
    } catch {
      return { matches: [], status: "unavailable", complete: false };
    } finally {
      clearTimeout(timer);
      ctx.signal?.removeEventListener("abort", abort);
      activeProviderRequests -= 1;
    }
  } };
}
