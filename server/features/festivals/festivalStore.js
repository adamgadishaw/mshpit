import { FESTIVAL_CATALOG } from "./festivalCatalog.js";
import { editionDays, expectedEdition, groupFestivalEditions } from "./festivalEditions.js";

// Festivals, their editions (one dated run in one place), the ticket
// listings each edition was built from, and members' plans for an edition:
// which days they are going and the sets they don't want to miss.

const DAY_MS = 86_400_000;
const parse = (value, fallback) => { try { const parsed = JSON.parse(value ?? ""); return parsed ?? fallback; } catch { return fallback; } };
const today = (now) => new Date(now).toISOString().slice(0, 10);
export const FESTIVAL_PLAN_LIMITS = Object.freeze({ mustSee: 30 });

export function ensureFestivalSchema(database, { now = Date.now } = {}) {
  database.exec(`CREATE TABLE IF NOT EXISTS festivals (
      slug TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      city TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      wikipedia_title TEXT,
      about TEXT,
      about_source TEXT,
      founded_year INTEGER,
      website TEXT,
      knowledge_checked_at INTEGER NOT NULL DEFAULT 0,
      scan_checked_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS festival_listings (
      provider_event_id TEXT PRIMARY KEY,
      festival_slug TEXT NOT NULL REFERENCES festivals(slug) ON DELETE CASCADE,
      name TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT,
      venue TEXT, venue_id TEXT, city TEXT, region TEXT, country_code TEXT, lat REAL, lng REAL,
      image_url TEXT, image_attribution TEXT, ticket_url TEXT,
      acts TEXT NOT NULL DEFAULT '[]',
      first_seen_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_festival_listings_festival ON festival_listings(festival_slug, start_date);
    CREATE TABLE IF NOT EXISTS festival_editions (
      id TEXT PRIMARY KEY,
      festival_slug TEXT NOT NULL REFERENCES festivals(slug) ON DELETE CASCADE,
      name TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      venue TEXT, city TEXT, region TEXT, country_code TEXT, lat REAL, lng REAL,
      image_url TEXT, image_attribution TEXT, ticket_url TEXT,
      lineup TEXT NOT NULL DEFAULT '[]',
      lineup_count INTEGER NOT NULL DEFAULT 0,
      first_seen_at INTEGER NOT NULL,
      lineup_changed_at INTEGER,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_festival_editions_start ON festival_editions(start_date, id);
    CREATE INDEX IF NOT EXISTS idx_festival_editions_festival ON festival_editions(festival_slug, start_date);
    CREATE TABLE IF NOT EXISTS festival_plans (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      edition_id TEXT NOT NULL REFERENCES festival_editions(id) ON DELETE CASCADE,
      days TEXT NOT NULL DEFAULT '[]',
      must_see TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, edition_id)
    );
    CREATE INDEX IF NOT EXISTS idx_festival_plans_edition ON festival_plans(edition_id);`);
  // The catalog is identity only; knowledge and scan times are kept.
  const upsert = database.prepare(`INSERT INTO festivals (slug,name,city,country,wikipedia_title,updated_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(slug) DO UPDATE SET name=excluded.name, city=excluded.city, country=excluded.country,
      wikipedia_title=excluded.wikipedia_title,
      knowledge_checked_at=CASE WHEN festivals.wikipedia_title IS excluded.wikipedia_title THEN festivals.knowledge_checked_at ELSE 0 END,
      updated_at=CASE WHEN festivals.name=excluded.name AND festivals.city=excluded.city AND festivals.country=excluded.country
        AND festivals.wikipedia_title IS excluded.wikipedia_title THEN festivals.updated_at ELSE excluded.updated_at END`);
  for (const entry of FESTIVAL_CATALOG) upsert.run(entry.slug, entry.name, entry.city, entry.country, entry.wikipedia, now());
}

export function createFestivalStore(database, { now = Date.now } = {}) {
  const saveListing = database.prepare(`INSERT INTO festival_listings (provider_event_id,festival_slug,name,start_date,end_date,venue,venue_id,city,region,
      country_code,lat,lng,image_url,image_attribution,ticket_url,acts,first_seen_at,last_seen_at)
    VALUES (@providerEventId,@festivalSlug,@name,@startDate,@endDate,@venue,@venueId,@city,@region,@countryCode,@lat,@lng,@imageUrl,@imageAttribution,@ticketUrl,@acts,@at,@at)
    ON CONFLICT(provider_event_id) DO UPDATE SET festival_slug=excluded.festival_slug, name=excluded.name, start_date=excluded.start_date,
      end_date=excluded.end_date, venue=excluded.venue, venue_id=excluded.venue_id, city=excluded.city, region=excluded.region,
      country_code=excluded.country_code, lat=excluded.lat, lng=excluded.lng,
      image_url=COALESCE(excluded.image_url, festival_listings.image_url),
      image_attribution=CASE WHEN excluded.image_url IS NOT NULL THEN excluded.image_attribution ELSE festival_listings.image_attribution END,
      ticket_url=COALESCE(excluded.ticket_url, festival_listings.ticket_url),
      acts=CASE WHEN json_array_length(excluded.acts) >= json_array_length(festival_listings.acts) THEN excluded.acts ELSE festival_listings.acts END,
      last_seen_at=excluded.last_seen_at`);
  const listingsFor = database.prepare("SELECT * FROM festival_listings WHERE festival_slug=? ORDER BY start_date, provider_event_id");
  const editionsFor = database.prepare("SELECT * FROM festival_editions WHERE festival_slug=? ORDER BY start_date, id");
  const insertEdition = database.prepare(`INSERT INTO festival_editions (id,festival_slug,name,start_date,end_date,venue,city,region,country_code,lat,lng,
      image_url,image_attribution,ticket_url,lineup,lineup_count,first_seen_at,lineup_changed_at,updated_at)
    VALUES (@id,@festivalSlug,@name,@startDate,@endDate,@venue,@city,@region,@countryCode,@lat,@lng,@imageUrl,@imageAttribution,@ticketUrl,@lineup,@lineupCount,@at,@lineupChangedAt,@at)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, start_date=excluded.start_date, end_date=excluded.end_date, venue=excluded.venue,
      city=excluded.city, region=excluded.region, country_code=excluded.country_code, lat=excluded.lat, lng=excluded.lng,
      image_url=COALESCE(excluded.image_url, festival_editions.image_url),
      image_attribution=CASE WHEN excluded.image_url IS NOT NULL THEN excluded.image_attribution ELSE festival_editions.image_attribution END,
      ticket_url=COALESCE(excluded.ticket_url, festival_editions.ticket_url),
      lineup=excluded.lineup, lineup_count=excluded.lineup_count,
      lineup_changed_at=CASE WHEN festival_editions.lineup=excluded.lineup THEN festival_editions.lineup_changed_at ELSE excluded.lineup_changed_at END,
      updated_at=excluded.updated_at`);
  const tourDateFestivalRows = database.prepare(`SELECT provider_event_id, event_name, date, event_end_date, venue, venue_provider_id, venue_city,
      venue_region, venue_country_code, lat, lng, event_image_url, event_image_attribution, ticket_url, billed_artists
    FROM tour_dates WHERE event_kind IN ('festival','multi_day') AND provider_event_id IS NOT NULL AND source='ticketmaster'
      AND date >= ? ORDER BY date LIMIT 2000`);

  return Object.freeze({
    saveListings(listings) {
      const at = now();
      for (const listing of listings) {
        saveListing.run({ providerEventId: listing.providerEventId, festivalSlug: listing.festivalSlug, name: listing.name, startDate: listing.startDate,
          endDate: listing.endDate || null, venue: listing.venue || null, venueId: listing.venueId || null,
          city: listing.city || null, region: listing.region || null, countryCode: listing.countryCode || null,
          lat: Number.isFinite(listing.lat) ? listing.lat : null, lng: Number.isFinite(listing.lng) ? listing.lng : null,
          imageUrl: listing.imageUrl || null, imageAttribution: listing.imageAttribution || null, ticketUrl: listing.ticketUrl || null,
          acts: JSON.stringify(listing.acts || []), at });
      }
    },

    // Festival rows the regular tour-date ingest already stored (no extra
    // provider requests), for the given catalog matcher.
    tourDateListings(match) {
      const since = today(now() - 60 * DAY_MS);
      const out = [];
      for (const row of tourDateFestivalRows.all(since)) {
        const entry = match(row.event_name);
        if (!entry) continue;
        out.push({ festivalSlug: entry.slug, providerEventId: `tm:${row.provider_event_id}`, name: row.event_name, startDate: row.date,
          endDate: row.event_end_date || row.date, venue: row.venue, venueId: row.venue_provider_id, city: row.venue_city, region: row.venue_region,
          countryCode: row.venue_country_code, lat: row.lat, lng: row.lng, imageUrl: row.event_image_url, imageAttribution: row.event_image_attribution,
          ticketUrl: row.ticket_url, entry, billed: parse(row.billed_artists, []) });
      }
      return out;
    },

    // Rebuild a festival's editions from every listing seen for it. An edition
    // keeps its id (and members' plans) when its dates move a little.
    rebuildEditions(festivalSlug, { quiet = false } = {}) {
      const at = now();
      const listings = listingsFor.all(festivalSlug).map((row) => ({
        festivalSlug, providerEventId: row.provider_event_id, name: row.name, startDate: row.start_date, endDate: row.end_date,
        venue: row.venue, venueId: row.venue_id, city: row.city, region: row.region, countryCode: row.country_code,
        lat: row.lat, lng: row.lng, imageUrl: row.image_url, imageAttribution: row.image_attribution, ticketUrl: row.ticket_url,
        acts: parse(row.acts, []),
      }));
      const existing = editionsFor.all(festivalSlug);
      const claimed = new Set();
      const gap = (row, edition) => Math.abs(Date.parse(`${row.start_date}T00:00:00Z`) - Date.parse(`${edition.startDate}T00:00:00Z`));
      let changed = 0;
      for (const edition of groupFestivalEditions(listings)) {
        // The same id when the dates are unchanged; otherwise the closest
        // unclaimed edition in the same city within ten days (a date change),
        // so a festival's two weekends never swap ids.
        const near = existing.find((row) => row.id === edition.id && !claimed.has(row.id))
          || existing.filter((row) => !claimed.has(row.id) && (row.city || "") === (edition.city || "") && gap(row, edition) <= 10 * DAY_MS)
            .sort((a, b) => gap(a, edition) - gap(b, edition))[0];
        if (near) claimed.add(near.id);
        const lineup = JSON.stringify(edition.lineup);
        if (near?.lineup !== lineup) changed += 1;
        insertEdition.run({ id: near?.id || edition.id, festivalSlug: edition.festivalSlug, name: edition.name, startDate: edition.startDate,
          endDate: edition.endDate, venue: edition.venue, city: edition.city, region: edition.region, countryCode: edition.countryCode,
          lat: edition.lat, lng: edition.lng, imageUrl: edition.imageUrl, imageAttribution: edition.imageAttribution, ticketUrl: edition.ticketUrl,
          lineup, lineupCount: edition.lineup.length, lineupChangedAt: edition.lineup.length && !quiet ? at : null, at });
      }
      return changed;
    },
  });
}

// Reading festivals for the app and the public pages.
export function createFestivalReader(database, { now = Date.now } = {}) {
  const festivalBySlug = database.prepare("SELECT * FROM festivals WHERE slug=?");
  const allFestivals = database.prepare("SELECT * FROM festivals ORDER BY name");
  const editionsFor = database.prepare("SELECT * FROM festival_editions WHERE festival_slug=? ORDER BY start_date DESC, id LIMIT 30");
  const upcomingEditions = database.prepare(`SELECT e.*, f.name AS festival_name,
      (SELECT COUNT(*) FROM festival_plans p JOIN users u ON u.id=p.user_id WHERE p.edition_id=e.id AND u.is_banned=0) AS going
    FROM festival_editions e JOIN festivals f ON f.slug=e.festival_slug
    WHERE e.end_date >= ? AND (? = '' OR e.country_code = ?)
    ORDER BY e.start_date, e.id LIMIT ?`);
  const editionById = database.prepare("SELECT * FROM festival_editions WHERE id=?");
  const goingByDay = database.prepare(`SELECT day.value AS day, COUNT(*) AS going FROM festival_plans p JOIN users u ON u.id=p.user_id,
      json_each(CASE WHEN json_valid(p.days) THEN p.days ELSE '[]' END) day
    WHERE p.edition_id=? AND u.is_banned=0 GROUP BY day.value`);
  const goingTotal = database.prepare("SELECT COUNT(*) AS n FROM festival_plans p JOIN users u ON u.id=p.user_id WHERE p.edition_id=? AND u.is_banned=0");
  const mustSeeTop = database.prepare(`SELECT MIN(act.value) AS name, COUNT(*) AS fans FROM festival_plans p JOIN users u ON u.id=p.user_id,
      json_each(CASE WHEN json_valid(p.must_see) THEN p.must_see ELSE '[]' END) act
    WHERE p.edition_id=? AND u.is_banned=0 GROUP BY lower(act.value) ORDER BY fans DESC, name LIMIT 12`);
  const planFor = database.prepare("SELECT * FROM festival_plans WHERE user_id=? AND edition_id=?");
  const festivalReviews = database.prepare(`SELECT p.id, p.artist, p.date, p.end_date, p.overall, p.review, p.city, p.venue, p.created_at,
      p.photos, p.photos_public,
      u.id AS user_id, u.name AS user_name, u.handle AS user_handle
    FROM posts p JOIN users u ON u.id=p.user_id
    WHERE p.removed=0 AND p.show_format='festival' AND COALESCE(p.kind,'review')='review' AND u.is_banned=0 AND u.dormant_at IS NULL
      AND EXISTS (SELECT 1 FROM json_each(?) phrase WHERE instr(lower(p.artist), phrase.value) > 0)
    ORDER BY CASE WHEN p.date<>'' THEN p.date ELSE '' END DESC, p.created_at DESC LIMIT 12`);
  const reviewStats = database.prepare(`SELECT COUNT(*) AS reviews, AVG(p.overall) AS average FROM posts p JOIN users u ON u.id=p.user_id
    WHERE p.removed=0 AND p.show_format='festival' AND COALESCE(p.kind,'review')='review' AND u.is_banned=0
      AND EXISTS (SELECT 1 FROM json_each(?) phrase WHERE instr(lower(p.artist), phrase.value) > 0)`);

  const editionJson = (row, { full = false } = {}) => {
    const lineup = parse(row.lineup, []);
    return {
      id: row.id,
      festivalSlug: row.festival_slug,
      name: row.name,
      startDate: row.start_date,
      endDate: row.end_date,
      days: editionDays(row.start_date, row.end_date),
      venue: row.venue || null,
      city: row.city || null,
      region: row.region || null,
      countryCode: row.country_code || null,
      imageUrl: row.image_url || null,
      imageAttribution: row.image_attribution || null,
      ticketUrl: row.ticket_url || null,
      lineupCount: Number(row.lineup_count) || lineup.length,
      headliners: lineup.slice(0, 6).map((act) => act.name),
      lineupChangedAt: row.lineup_changed_at || null,
      ...(full ? { lineup } : {}),
      ...(row.going != null ? { going: Number(row.going) || 0 } : {}),
    };
  };

  const catalogPhrases = (slug) => {
    const entry = FESTIVAL_CATALOG_BY_SLUG.get(slug);
    return JSON.stringify(entry ? entry.match : []);
  };

  return Object.freeze({
    upcoming({ country = "", limit = 60 } = {}) {
      return upcomingEditions.all(today(now()), country, country, Math.min(100, Math.max(1, limit))).map((row) => ({
        ...editionJson(row), festivalName: row.festival_name,
      }));
    },

    festivals() {
      return allFestivals.all().map((row) => ({ slug: row.slug, name: row.name, city: row.city, country: row.country }));
    },

    festival(slug, { viewerId = null } = {}) {
      const row = festivalBySlug.get(slug);
      if (!row) return null;
      const editions = editionsFor.all(slug);
      const current = today(now());
      const upcoming = editions.filter((edition) => edition.end_date >= current).sort((a, b) => a.start_date.localeCompare(b.start_date));
      const past = editions.filter((edition) => edition.end_date < current);
      const phrases = catalogPhrases(slug);
      const stats = reviewStats.get(phrases);
      return {
        festival: {
          slug: row.slug, name: row.name, city: row.city, country: row.country,
          about: row.about || null, aboutSource: parse(row.about_source, null), foundedYear: row.founded_year || null, website: row.website || null,
        },
        upcoming: upcoming.map((edition) => {
          const byDay = Object.fromEntries(goingByDay.all(edition.id).map((day) => [day.day, Number(day.going) || 0]));
          const plan = viewerId ? planFor.get(viewerId, edition.id) : null;
          return {
            ...editionJson(edition, { full: true }),
            going: Number(goingTotal.get(edition.id)?.n) || 0,
            goingByDay: byDay,
            mustSee: mustSeeTop.all(edition.id).map((act) => ({ name: act.name, fans: Number(act.fans) || 0 })),
            ...(viewerId ? { plan: plan ? { days: parse(plan.days, []), mustSee: parse(plan.must_see, []), updatedAt: plan.updated_at } : null } : {}),
          };
        }),
        past: past.map((edition) => editionJson(edition)),
        expected: upcoming.length ? null : expectedEdition(past.map((edition) => ({ startDate: edition.start_date, endDate: edition.end_date, city: edition.city })), { today: current }),
        reviews: festivalReviews.all(phrases).map((review) => ({
          postId: review.id, name: review.artist, date: review.date || "", endDate: review.end_date || "", overall: review.overall,
          review: String(review.review || "").slice(0, 280), city: review.city || "", venue: review.venue || "",
          // Only photos the author chose to share publicly.
          photos: review.photos_public ? parse(review.photos, []).filter((url) => typeof url === "string" && /^https:\/\//u.test(url)).slice(0, 3) : [],
          user: { id: review.user_id, name: review.user_name, handle: review.user_handle },
        })),
        reviewStats: { reviews: Number(stats?.reviews) || 0, average: stats?.average == null ? null : Math.round(Number(stats.average) * 10) / 10 },
      };
    },

    edition(id) {
      const row = editionById.get(id);
      return row ? editionJson(row, { full: true }) : null;
    },
  });
}

const FESTIVAL_CATALOG_BY_SLUG = new Map(FESTIVAL_CATALOG.map((entry) => [entry.slug, entry]));
