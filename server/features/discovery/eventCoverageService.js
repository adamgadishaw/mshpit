import { activeAccountSql } from "../../accountVisibility.js";
import { tourDateHasNoPublishedMemorialSql } from "../../artistMemorialTourDateVisibility.js";
import { currentOrUpcomingTourDateSql } from "../../tourDateLifecycle.js";
import { isCurrentOrUpcomingLiveEvent, liveEventQueryFloorDate } from "../../../src/domain/eventLifecycle.mjs";
import { discoverCountryCode, discoverCountryIdentity, discoverCountryLabel } from "../../../src/domain/discoverScene.mjs";

const CACHE_MS = 60_000;
const installed = new WeakSet();

function installLifecycle(database) {
  if (installed.has(database)) return;
  database.function("pit_discover_event_current", { deterministic: true }, (date, end, timezone, at) => (
    isCurrentOrUpcomingLiveEvent({ date, eventEndDate: end, eventTimezone: timezone }, Number(at)) ? 1 : 0
  ));
  installed.add(database);
}

// Count the public inventory in SQLite. A paginated first-paint snapshot can
// never establish that an entire country has no events. Only aggregates leave
// this query; no private attendee, user, or unpublished event data is returned.
export function createEventCoverageService({ database, clock = Date.now } = {}) {
  let cached = null;
  let statement = null;

  function read() {
    const at = clock();
    if (cached && at >= cached.at && at - cached.at < CACHE_MS) return cached.value;
    installLifecycle(database);
    statement ||= database.prepare(`
      SELECT UPPER(TRIM(COALESCE(td.venue_country_code,''))) AS country_code,
        MIN(TRIM(COALESCE(td.venue_country,''))) AS country,
        COUNT(*) AS count,
        COUNT(DISTINCT CASE WHEN TRIM(COALESCE(td.venue,''))<>'' THEN
          LOWER(TRIM(td.venue))||char(0)||LOWER(TRIM(COALESCE(td.venue_city,''))) END) AS venue_count
      FROM tour_dates td
      LEFT JOIN users owner ON owner.id=td.owner_id
      WHERE COALESCE(td.music_qualified,1)=1
        AND td.release_at<=?1
        AND (td.owner_id IS NULL OR (${activeAccountSql("owner")}))
        AND (td.owner_id IS NOT NULL OR COALESCE(td.provider_active,1)=1)
        AND ${currentOrUpcomingTourDateSql("td", "?2")}
        AND ${tourDateHasNoPublishedMemorialSql("td")}
        AND pit_discover_event_current(td.date,td.event_end_date,td.event_timezone,?1)=1
      GROUP BY UPPER(TRIM(COALESCE(td.venue_country_code,''))),
        CASE WHEN TRIM(COALESCE(td.venue_country_code,''))='' THEN LOWER(TRIM(COALESCE(td.venue_country,''))) ELSE '' END
      ORDER BY count DESC
    `);
    const rows = statement.all(at, liveEventQueryFloorDate(at));
    const grouped = new Map();
    let total = 0;
    let venueTotal = 0;
    for (const row of rows) {
      const count = Number(row.count) || 0;
      const venueCount = Number(row.venue_count) || 0;
      total += count;
      venueTotal += venueCount;
      const country = discoverCountryLabel(row.country_code) || discoverCountryLabel(row.country)
        || String(row.country || row.country_code || "").slice(0, 80).trim();
      if (!country) continue;
      const identity = discoverCountryIdentity(country);
      const entry = grouped.get(identity) || { country, countryCode: discoverCountryCode(country), count: 0, venueCount: 0 };
      entry.count += count;
      entry.venueCount += venueCount;
      grouped.set(identity, entry);
    }
    const value = {
      status: "ready",
      basis: "public-catalog",
      total,
      venueTotal,
      countries: [...grouped.values()].sort((a, b) => b.count - a.count || a.country.localeCompare(b.country)).slice(0, 300),
      generatedAt: new Date(at).toISOString(),
    };
    cached = { at, value };
    return value;
  }

  return { read, invalidate: () => { cached = null; } };
}
