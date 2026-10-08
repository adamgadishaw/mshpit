import { readBoundedJsonResponse, PROVIDER_JSON_LIMITS } from "../../boundedJsonResponse.js";
import { runBackgroundJob } from "../../backgroundJobCoordinator.js";
import { privateErrorLabel } from "../../errors.js";
import { startPeriodicJob } from "../../periodicJobScheduler.js";
import { createFestivalStore } from "./festivalStore.js";
import { selectTicketmasterEventImage } from "../../providerEventImage.js";
import { canonicalTicketUrl } from "../../../src/domain/ticketLinks.mjs";
import { FESTIVAL_CATALOG } from "./festivalCatalog.js";
import { festivalActs, matchFestival } from "./festivalEditions.js";
import { fetchFestivalKnowledge } from "./festivalKnowledge.js";

// Keeps festival editions current. Each pass looks up a few festivals on
// Ticketmaster (one request each, rotating through the whole list about once
// a day) so a new edition or lineup shows up soon after it is listed, folds in
// festival listings the regular tour-date ingest already stored, and refreshes
// each festival's Wikipedia history once a month.

const DAY_MS = 86_400_000;
export const FESTIVAL_SCAN_BATCH = 6;
export const FESTIVAL_KNOWLEDGE_BATCH = 4;
const KNOWLEDGE_MAX_AGE_MS = 30 * DAY_MS;
const CURSOR_KEY = "festivals:scan-cursor";
const FIRST_PASS_KEY = "festivals:first-pass-at";
// Lineups found during the first full cycle were announced before Mshpit
// started watching; only later ones count as "just announced".
const FIRST_CYCLE_MS = 30 * 60 * 60 * 1000;
const text = (value, max = 200) => {
  const clean = typeof value === "string" ? value.normalize("NFKC").replace(/\s+/gu, " ").trim() : "";
  return clean ? clean.slice(0, max) : null;
};
const coordinate = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= 180 ? number : null;
};

// On when a Ticketmaster key is set, unless FESTIVAL_SCAN_ENABLED says
// otherwise. The scan is a handful of requests an hour.
export function festivalScanEnabled(env = process.env) {
  const explicit = String(env?.FESTIVAL_SCAN_ENABLED ?? "").trim().toLowerCase();
  if (explicit) return ["1", "true", "yes", "on"].includes(explicit);
  return !!String(env?.TICKETMASTER_KEY || "").trim();
}

// One Ticketmaster response into listings for `entry`.
export function festivalListingsFromTicketmaster(entry, data) {
  const out = [];
  for (const event of Array.isArray(data?._embedded?.events) ? data._embedded.events.slice(0, 200) : []) {
    const name = text(event?.name);
    const venue = event?._embedded?.venues?.[0] || {};
    if (!name || matchFestival([entry], name, { city: venue.city?.name, region: venue.state?.stateCode || venue.state?.name, venue: venue.name, countryCode: venue.country?.countryCode })?.slug !== entry.slug) continue;
    const startDate = text(event.dates?.start?.localDate, 10);
    if (!startDate || !/^\d{4}-\d{2}-\d{2}$/u.test(startDate)) continue;
    const endDate = text(event.dates?.end?.localDate, 10);
    const image = selectTicketmasterEventImage(event);
    out.push({
      festivalSlug: entry.slug,
      providerEventId: `tm:${text(event.id, 80) || `${startDate}:${name}`}`,
      name,
      startDate,
      endDate: endDate && /^\d{4}-\d{2}-\d{2}$/u.test(endDate) ? endDate : startDate,
      venue: text(venue.name),
      venueId: text(venue.id, 80),
      city: text(venue.city?.name, 120),
      region: text(venue.state?.stateCode, 20) || text(venue.state?.name, 120),
      countryCode: text(venue.country?.countryCode, 2)?.toUpperCase() || null,
      lat: coordinate(venue.location?.latitude),
      lng: coordinate(venue.location?.longitude),
      imageUrl: image?.uri || null,
      imageAttribution: image?.attribution || null,
      ticketUrl: canonicalTicketUrl(event.url, { source: "ticketmaster", allowUntrusted: false }) || null,
      acts: festivalActs(entry, Array.isArray(event._embedded?.attractions) ? event._embedded.attractions.slice(0, 300) : []),
    });
  }
  return out;
}

// Ticketmaster Discovery search for one festival's listings from two weeks
// ago onward (a running edition stays visible until it ends).
export function festivalSearchUrl({ apiKey, keyword, startDateTime, size = 100 }) {
  const url = new URL("https://app.ticketmaster.com/discovery/v2/events.json");
  url.searchParams.set("keyword", keyword);
  url.searchParams.set("classificationName", "music");
  url.searchParams.set("startDateTime", startDateTime);
  url.searchParams.set("locale", "*");
  url.searchParams.set("size", String(Math.max(1, Math.min(200, size))));
  url.searchParams.set("sort", "date,asc");
  url.searchParams.set("apikey", apiKey);
  return url.toString();
}

async function ticketmasterJson(url, { signal, fetchImpl }) {
  const timeout = AbortSignal.timeout(15_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetchImpl(url, { signal: combined, headers: { "User-Agent": "mshpit.com" } });
  if (!response.ok) throw Object.assign(new Error("Ticketmaster is unavailable."), { code: `festival_scan_${response.status === 429 ? "rate_limited" : "unavailable"}` });
  return readBoundedJsonResponse(response, { maxBytes: PROVIDER_JSON_LIMITS.tourDates, signal: combined });
}

function readCursor(database) {
  const value = Number(database.prepare("SELECT value FROM app_meta WHERE key=?").get(CURSOR_KEY)?.value);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function writeCursor(database, value) {
  database.prepare("INSERT INTO app_meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(CURSOR_KEY, String(value));
}

// One pass. Returns a summary for the log.
export async function runFestivalScan({ database, store, env = process.env, signal, fetchImpl = fetch, now = Date.now,
  knowledge = fetchFestivalKnowledge, catalog = FESTIVAL_CATALOG }) {
  const summary = { scanned: 0, listings: 0, editionsChanged: 0, knowledge: 0, failures: 0 };
  const touched = new Set();
  // 1. Festival rows the tour-date ingest already has: free.
  const known = store.tourDateListings((name, location) => matchFestival(catalog, name, location));
  store.saveListings(known.map(({ entry, billed, ...listing }) => ({ ...listing, acts: festivalActs(entry, billed) })));
  for (const listing of known) touched.add(listing.festivalSlug);
  // 2. A rotating batch straight from Ticketmaster.
  const apiKey = String(env.TICKETMASTER_KEY || "").trim();
  if (apiKey) {
    const start = readCursor(database) % catalog.length;
    const batch = Array.from({ length: Math.min(FESTIVAL_SCAN_BATCH, catalog.length) }, (_, index) => catalog[(start + index) % catalog.length]);
    const from = new Date(now() - 14 * DAY_MS).toISOString().replace(/\.\d{3}Z$/u, "Z");
    for (const entry of batch) {
      if (signal?.aborted) break;
      try {
        const data = await ticketmasterJson(festivalSearchUrl({ apiKey, keyword: entry.search, startDateTime: from }), { signal, fetchImpl });
        const listings = festivalListingsFromTicketmaster(entry, data);
        store.saveListings(listings);
        summary.listings += listings.length;
        summary.scanned += 1;
        touched.add(entry.slug);
        database.prepare("UPDATE festivals SET scan_checked_at=? WHERE slug=?").run(now(), entry.slug);
      } catch (error) {
        if (signal?.aborted) break;
        summary.failures += 1;
        if (error?.code === "festival_scan_rate_limited") break;
      }
    }
    writeCursor(database, (start + batch.length) % catalog.length);
  }
  let firstPassAt = Number(database.prepare("SELECT value FROM app_meta WHERE key=?").get(FIRST_PASS_KEY)?.value);
  if (!Number.isSafeInteger(firstPassAt)) {
    firstPassAt = now();
    database.prepare("INSERT OR IGNORE INTO app_meta (key,value) VALUES (?,?)").run(FIRST_PASS_KEY, String(firstPassAt));
  }
  const quiet = now() < firstPassAt + FIRST_CYCLE_MS;
  for (const slug of touched) summary.editionsChanged += store.rebuildEditions(slug, { quiet });
  // 3. Histories: festivals with dates coming up first, then the oldest.
  const stale = database.prepare(`SELECT f.slug, f.wikipedia_title FROM festivals f WHERE f.wikipedia_title IS NOT NULL AND f.knowledge_checked_at < ?
    ORDER BY EXISTS (SELECT 1 FROM festival_editions e WHERE e.festival_slug=f.slug AND e.end_date >= ?) DESC, f.knowledge_checked_at, f.slug
    LIMIT ?`).all(now() - KNOWLEDGE_MAX_AGE_MS, new Date(now()).toISOString().slice(0, 10), FESTIVAL_KNOWLEDGE_BATCH);
  const saveKnowledge = database.prepare(`UPDATE festivals SET about=COALESCE(?, about), about_source=COALESCE(?, about_source),
      founded_year=COALESCE(?, founded_year), website=COALESCE(?, website), knowledge_checked_at=? WHERE slug=?`);
  for (const row of stale) {
    if (signal?.aborted) break;
    try {
      const found = await knowledge({ wikipediaTitle: row.wikipedia_title, fetchImpl, signal, now });
      saveKnowledge.run(found?.about || null, found ? JSON.stringify(found.source) : null, found?.foundedYear || null, found?.website || null, now(), row.slug);
      if (found) summary.knowledge += 1;
    } catch (error) {
      if (signal?.aborted) break;
      summary.failures += 1;
      // Try again tomorrow rather than on every pass.
      saveKnowledge.run(null, null, null, null, now() - KNOWLEDGE_MAX_AGE_MS + DAY_MS, row.slug);
      if (/rate_limited/u.test(String(error?.code))) break;
    }
  }
  return summary;
}

// Every three hours, queued with the other provider jobs.
export function startFestivalScheduler({ database, env = process.env, now = Date.now, startJob = startPeriodicJob, coordinate = runBackgroundJob }) {
  if (!festivalScanEnabled(env)) return null;
  const store = createFestivalStore(database, { now });
  return startJob({
    initialDelayMs: 3 * 60 * 1000,
    intervalMs: 3 * 60 * 60 * 1000,
    run: ({ signal }) => coordinate(async () => {
      const summary = await runFestivalScan({ database, store, env, signal, now });
      console.log(`[festivals] scanned ${summary.scanned}, ${summary.listings} listings, ${summary.editionsChanged} editions changed, ${summary.knowledge} histories, ${summary.failures} failures`);
      return true;
    }),
    report: (error) => console.error(`[festivals] pass failed safely: ${privateErrorLabel(error)}`),
  });
}
