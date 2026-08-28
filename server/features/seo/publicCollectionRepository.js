import { activeAccountSql } from "../../accountVisibility.js";
import { slugify } from "../../../src/domain/urls.mjs";
import { archiveIdentityPart } from "../artistArchive/artistArchiveKeys.js";
import { currentOrUpcomingTourDateSql, effectiveTourDateEndSql } from "../../tourDateLifecycle.js";
import { tourDateHasNoPublishedMemorialSql } from "../../artistMemorialTourDateVisibility.js";
import {
  PUBLIC_ENTITY_THRESHOLDS,
  isStrictCalendarDate,
  qualifiesCityConcertDirectory,
  qualifiesCityVenueDirectory,
  structuredShowLocationKey,
} from "./publicEntityPolicy.js";

const MAX_PAGE = 1_000;
const validCalendarDateSql = (a) => `${a}.date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(${a}.date)=${a}.date`;
const structuredLocationSql = (a) => `TRIM(COALESCE(${a}.venue_city,''))<>'' AND LENGTH(TRIM(COALESCE(${a}.venue_country_code,'')))=2 AND UPPER(TRIM(${a}.venue_country_code)) GLOB '[A-Z][A-Z]'`;
const publicTourVisibility = (a, owner, at) => `${a}.release_at<=${at} AND COALESCE(${a}.music_qualified,1)=1 AND (${a}.owner_id IS NULL OR ${activeAccountSql(owner)}) AND (${a}.owner_id IS NOT NULL OR COALESCE(${a}.provider_active,1)=1)`;

const noStructuredShowLocationCollisionSql = (alias = "p", at = "?4", today = "?5") => `NOT EXISTS (
  SELECT COUNT(DISTINCT pit_structured_show_location(public_location.venue_city,public_location.venue_country_code)) AS location_count FROM tour_dates public_location
  LEFT JOIN users public_location_owner ON public_location_owner.id=public_location.owner_id
  WHERE LOWER(TRIM(public_location.artist))=LOWER(TRIM(${alias}.artist))
    AND LOWER(TRIM(public_location.venue))=LOWER(TRIM(${alias}.venue))
    AND public_location.date=${alias}.date AND public_location.release_at<=${at}
    AND (public_location.owner_id IS NULL OR ${activeAccountSql("public_location_owner")})
    AND (public_location.owner_id IS NOT NULL OR COALESCE(public_location.provider_active,1)=1
      OR ${effectiveTourDateEndSql("public_location")}<${today})
  HAVING location_count>1
)`;

// A media-only review is evidence only after the same owned, sanitized
// publication boundary used by the public document projector.
const readyMediaEvidenceSql = (p = "p") => `EXISTS (
  SELECT 1 FROM post_media linked
  JOIN media_assets asset ON asset.id=linked.asset_id AND asset.owner_id=${p}.user_id
  JOIN media_objects source_object ON source_object.owner_id=asset.owner_id AND source_object.object_key=asset.source_key
  LEFT JOIN media_variants render_variant ON render_variant.id=asset.render_variant_id
    AND render_variant.asset_id=asset.id AND render_variant.role='render'
  LEFT JOIN media_objects render_object ON render_object.owner_id=asset.owner_id
    AND render_object.object_key=render_variant.object_key
  WHERE linked.post_id=${p}.id AND asset.status='ready' AND asset.source_verified_at IS NOT NULL
    AND asset.metadata_status='declared'
    AND ((asset.kind='image' AND asset.codec_status='not_applicable')
      OR (asset.kind='video' AND asset.codec_status='verified'))
    AND source_object.status IN ('issued','associated')
    AND ((asset.kind='video' AND asset.render_state='not_required' AND asset.source_storage_scope='public')
      OR (asset.render_state='ready' AND render_variant.status='verified'
        AND (asset.kind!='image' OR render_variant.verification_origin='private_derivative_v1')
        AND render_object.storage_scope='public' AND render_object.status IN ('issued','associated')))
)`;
const eligiblePostSql = (p = "p") => `(LENGTH(TRIM(COALESCE(${p}.review,'')))>=${PUBLIC_ENTITY_THRESHOLDS.authoredBodyCharacters}
  OR (${p}.photos_public=1 AND ${readyMediaEvidenceSql(p)}))`;

function requestedPage(value) {
  const page = Number(value ?? 1);
  return Number.isSafeInteger(page) && page >= 1 && page <= MAX_PAGE ? page : null;
}
function requestedPageSize(value) {
  const size = Number(value ?? PUBLIC_ENTITY_THRESHOLDS.collectionPageSize);
  return Number.isSafeInteger(size) && size > 0
    ? Math.min(size, PUBLIC_ENTITY_THRESHOLDS.collectionPageSize)
    : PUBLIC_ENTITY_THRESHOLDS.collectionPageSize;
}
function requestedInstant(value) {
  const at = Number(value);
  return Number.isSafeInteger(at) && at >= 0 ? at : Date.now();
}
const requestedDay = (value, at) => isStrictCalendarDate(value)
  ? String(value) : new Date(at).toISOString().slice(0, 10);
const requestedCountryCode = (value) => {
  const code = String(value || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
};
const requestedCitySlug = (value) => {
  const city = String(value || "").trim().toLowerCase();
  return city && slugify(city) === city ? city : null;
};

/**
 * Bounded crawler collection reads. No method projects attendee or account
 * identities, and city identity never comes from posts.city or free-form place.
 */
export function createPublicCollectionRepository(database) {
  if (!database?.prepare) throw new TypeError("Public SEO collections require a database");
  database.function?.("pit_archive_identity", { deterministic: true }, archiveIdentityPart);
  database.function?.("pit_public_slug", { deterministic: true }, slugify);
  database.function?.("pit_structured_show_location", { deterministic: true }, (city, countryCode) =>
    structuredShowLocationKey({ venue_city: city, venue_country_code: countryCode }));

  const resolveCity = database.prepare(`WITH candidates AS (
    SELECT TRIM(td.venue_city) AS display_city,NULLIF(TRIM(td.venue_country),'') AS display_country
    FROM tour_dates td LEFT JOIN users owner ON owner.id=td.owner_id
    WHERE ${publicTourVisibility("td", "owner", "?")}
      AND ${validCalendarDateSql("td")} AND ${structuredLocationSql("td")}
      AND TRIM(COALESCE(td.artist,''))<>'' AND TRIM(COALESCE(td.venue,''))<>''
      AND UPPER(TRIM(td.venue_country_code))=? AND pit_public_slug(td.venue_city)=?
  )
  SELECT MIN(display_city) AS display_city,COALESCE(MIN(display_country),?) AS display_country
  FROM candidates GROUP BY LOWER(display_city) ORDER BY LOWER(display_city) LIMIT 2`);

  const noLocationConflictSql = (td = "td") => `NOT EXISTS (
    SELECT 1 FROM tour_dates conflict
    LEFT JOIN users conflict_owner ON conflict_owner.id=conflict.owner_id
    WHERE ${publicTourVisibility("conflict", "conflict_owner", "?1")}
      AND ${validCalendarDateSql("conflict")} AND ${structuredLocationSql("conflict")}
      AND LOWER(TRIM(conflict.artist))=LOWER(TRIM(${td}.artist))
      AND LOWER(TRIM(conflict.venue))=LOWER(TRIM(${td}.venue))
      AND conflict.date=${td}.date
      AND (UPPER(TRIM(conflict.venue_country_code))<>UPPER(TRIM(${td}.venue_country_code))
        OR LOWER(TRIM(conflict.venue_city))<>LOWER(TRIM(${td}.venue_city)))
  )`;

  const cityVenues = database.prepare(`WITH target_events AS (
    SELECT td.*,LOWER(TRIM(td.artist)) AS show_artist,LOWER(TRIM(td.venue)) AS show_venue,
      CASE WHEN TRIM(COALESCE(td.venue_provider_id,''))<>''
        THEN 'provider:'||LOWER(TRIM(COALESCE(td.source,'')))||':'||LOWER(TRIM(td.venue_provider_id))
        ELSE 'name:'||LOWER(TRIM(td.venue)) END AS venue_identity
    FROM tour_dates td LEFT JOIN users owner ON owner.id=td.owner_id
    WHERE ${publicTourVisibility("td", "owner", "?1")}
      AND ${validCalendarDateSql("td")} AND ${structuredLocationSql("td")} AND ${currentOrUpcomingTourDateSql("td", "?2")}
      AND ${tourDateHasNoPublishedMemorialSql("td")}
      AND TRIM(COALESCE(td.artist,''))<>'' AND TRIM(COALESCE(td.venue,''))<>''
      AND UPPER(TRIM(td.venue_country_code))=?3 AND LOWER(TRIM(td.venue_city))=LOWER(?4)
      AND ${noLocationConflictSql("td")}
      AND (TRIM(COALESCE(td.venue_provider_id,''))<>'' OR NOT EXISTS (
        SELECT 1 FROM tour_dates venue_identity
        LEFT JOIN users venue_identity_owner ON venue_identity_owner.id=venue_identity.owner_id
        WHERE ${publicTourVisibility("venue_identity", "venue_identity_owner", "?1")}
          AND ${validCalendarDateSql("venue_identity")}
          AND LOWER(TRIM(venue_identity.venue))=LOWER(TRIM(td.venue))
          AND (
            TRIM(COALESCE(venue_identity.venue_provider_id,''))<>''
            OR NOT (${structuredLocationSql("venue_identity")})
            OR UPPER(TRIM(venue_identity.venue_country_code))<>UPPER(TRIM(td.venue_country_code))
            OR LOWER(TRIM(venue_identity.venue_city))<>LOWER(TRIM(td.venue_city))
          )
      ))
  ), unique_events AS (
    SELECT * FROM (
      SELECT target_events.*,ROW_NUMBER() OVER (
        PARTITION BY show_artist,show_venue,date
        ORDER BY CASE WHEN TRIM(COALESCE(provider_event_id,''))<>'' THEN 0 ELSE 1 END,
          LOWER(TRIM(COALESCE(source,''))),LOWER(TRIM(COALESCE(provider_event_id,''))),id
      ) AS show_rank FROM target_events
    ) WHERE show_rank=1
  ), venue_rows AS (
    SELECT venue_identity,MIN(venue) AS venue,MIN(NULLIF(TRIM(source),'')) AS source,
      MIN(NULLIF(TRIM(venue_provider_id),'')) AS venue_provider_id,
      MIN(NULLIF(TRIM(venue_region),'')) AS venue_region,
      MIN(NULLIF(TRIM(venue_country),'')) AS venue_country,
      COUNT(*) AS item_count,MIN(date) AS next_date,MAX(updated_at) AS latest_at,
      MIN(id) AS representative_event_id
    FROM unique_events GROUP BY venue_identity
  ), city_stats AS (
    SELECT COUNT(*) AS item_count,COUNT(DISTINCT venue_identity) AS venue_count FROM unique_events
  )
  SELECT venue_rows.*,city_stats.item_count AS city_item_count,city_stats.venue_count AS city_venue_count
  FROM venue_rows CROSS JOIN city_stats
  WHERE city_stats.item_count>=?5 AND city_stats.venue_count>=?6
  ORDER BY venue_rows.next_date,venue_rows.item_count DESC,venue_rows.venue COLLATE NOCASE,venue_rows.venue_identity
  LIMIT ?7 OFFSET ?8`);

  const locationShowsCte = `location_shows AS (
    SELECT LOWER(TRIM(td.artist)) AS display_artist_identity,
      LOWER(TRIM(td.venue)) AS display_venue_identity,td.date,
      MIN(td.artist_key) AS artist_key,MIN(td.artist) AS artist,MIN(td.venue) AS venue,
      MIN(NULLIF(TRIM(td.venue_region),'')) AS venue_region,
      MIN(NULLIF(TRIM(td.venue_country),'')) AS venue_country
    FROM tour_dates td LEFT JOIN users owner ON owner.id=td.owner_id
    WHERE ${publicTourVisibility("td", "owner", "?1")}
      AND ${validCalendarDateSql("td")} AND ${structuredLocationSql("td")} AND td.date<=?2
      AND TRIM(COALESCE(td.artist,''))<>'' AND TRIM(COALESCE(td.venue,''))<>''
      AND UPPER(TRIM(td.venue_country_code))=?3 AND LOWER(TRIM(td.venue_city))=LOWER(?4)
      AND ${noLocationConflictSql("td")}
    GROUP BY LOWER(TRIM(td.artist)),LOWER(TRIM(td.venue)),td.date
  )`;
  const eligibleConcertsCtes = `eligible_posts AS (
    SELECT p.*,
      pit_archive_identity(COALESCE(NULLIF(TRIM(p.artist_key),''),p.artist)) AS show_artist,
      pit_archive_identity(COALESCE(NULLIF(TRIM(p.venue_key),''),p.venue)) AS show_venue,
      COALESCE(p.updated_at,p.created_at) AS changed_at,
      location_shows.venue_region,location_shows.venue_country
    FROM location_shows
    JOIN posts p ON LOWER(p.venue)=location_shows.display_venue_identity
      AND p.date=location_shows.date
      AND (
        (p.artist_key IS NOT NULL AND location_shows.artist_key IS NOT NULL
          AND p.artist_key=location_shows.artist_key)
        OR (LOWER(p.artist)=location_shows.display_artist_identity
          AND (SELECT COUNT(*) FROM artists city_artist
            WHERE city_artist.name=p.artist COLLATE NOCASE)=1
          AND COALESCE(p.artist_key,(SELECT MIN(norm) FROM artists city_artist
            WHERE city_artist.name=p.artist COLLATE NOCASE))
            =COALESCE(location_shows.artist_key,(SELECT MIN(norm) FROM artists city_artist
              WHERE city_artist.name=p.artist COLLATE NOCASE)))
      )
    JOIN users author ON author.id=p.user_id
    WHERE p.removed=0 AND COALESCE(p.kind,'review')='review'
      AND ${validCalendarDateSql("p")} AND p.date<=?2 AND ${activeAccountSql("author")}
      AND ${eligiblePostSql("p")}
  ), ranked AS (
    SELECT eligible_posts.*,
      ROW_NUMBER() OVER (PARTITION BY show_artist,show_venue,date,user_id
        ORDER BY CASE WHEN overall BETWEEN 1 AND 5 THEN 0 ELSE 1 END,changed_at DESC,id DESC) AS rating_rank,
      ROW_NUMBER() OVER (PARTITION BY show_artist,show_venue,date
        ORDER BY changed_at DESC,id DESC) AS show_rank
    FROM eligible_posts
  ), people AS (
    SELECT show_artist,show_venue,date,user_id,
      MAX(CASE WHEN show_rank=1 THEN artist END) AS artist,
      MAX(CASE WHEN show_rank=1 THEN artist_key END) AS artist_key,
      MAX(CASE WHEN show_rank=1 THEN venue END) AS venue,
      MAX(CASE WHEN show_rank=1 THEN venue_key END) AS venue_key,
      MAX(CASE WHEN show_rank=1 THEN venue_region END) AS venue_region,
      MAX(CASE WHEN show_rank=1 THEN venue_country END) AS venue_country,
      MAX(CASE WHEN rating_rank=1 AND overall BETWEEN 1 AND 5 THEN overall END) AS rating,
      MAX(changed_at) AS latest_at
    FROM ranked GROUP BY show_artist,show_venue,date,user_id
  ), concerts AS (
    SELECT show_artist,show_venue,date,MAX(artist) AS artist,MAX(artist_key) AS artist_key,
      MAX(venue) AS venue,MAX(venue_key) AS venue_key,MAX(venue_region) AS venue_region,
      MAX(venue_country) AS venue_country,COUNT(*) AS review_count,COUNT(rating) AS rating_count,
      AVG(rating) AS average_rating,MAX(latest_at) AS latest_at
    FROM people GROUP BY show_artist,show_venue,date
  )`;

  const cityConcerts = database.prepare(`WITH ${locationShowsCte},${eligibleConcertsCtes},
  city_stats AS (
    SELECT COUNT(*) AS item_count,COUNT(DISTINCT show_venue) AS venue_count FROM concerts
  )
  SELECT concerts.*,a.public_slug AS artist_public_slug,
    city_stats.item_count AS city_item_count,city_stats.venue_count AS city_venue_count
  FROM concerts LEFT JOIN artists a ON a.norm=concerts.artist_key CROSS JOIN city_stats
  WHERE city_stats.item_count>=?5 AND city_stats.venue_count>=?6
  ORDER BY concerts.date DESC,concerts.review_count DESC,concerts.rating_count DESC,
    concerts.average_rating DESC,concerts.latest_at DESC,concerts.show_artist,concerts.show_venue
  LIMIT ?7 OFFSET ?8`);

  const artistByKey = database.prepare(`SELECT norm,name,public_slug,genre,bio,updated_at
    FROM artists WHERE norm=? AND public_slug IS NOT NULL AND TRIM(public_slug)<>'' LIMIT 2`);
  const artistBySlug = database.prepare(`SELECT norm,name,public_slug,genre,bio,updated_at
    FROM artists WHERE public_slug=? COLLATE NOCASE AND TRIM(public_slug)<>'' LIMIT 2`);
  const artistByName = database.prepare(`SELECT norm,name,public_slug,genre,bio,updated_at
    FROM artists WHERE name=? COLLATE NOCASE AND public_slug IS NOT NULL AND TRIM(public_slug)<>''
    ORDER BY norm LIMIT 2`);

  const artistConcerts = database.prepare(`WITH eligible_posts AS (
    SELECT p.*,pit_archive_identity(COALESCE(NULLIF(TRIM(p.venue_key),''),p.venue)) AS show_venue,
      COALESCE(p.updated_at,p.created_at) AS changed_at
    FROM posts p JOIN users author ON author.id=p.user_id
    WHERE p.removed=0 AND COALESCE(p.kind,'review')='review'
      AND ${validCalendarDateSql("p")} AND p.date<=?3
      AND (p.artist_key=?1 OR (p.artist_key IS NULL AND LOWER(p.artist)=LOWER(?2)
        AND (SELECT COUNT(*) FROM artists legacy_match WHERE legacy_match.name=p.artist COLLATE NOCASE)=1))
      AND ${activeAccountSql("author")} AND ${eligiblePostSql("p")}
      AND ${noStructuredShowLocationCollisionSql("p", "?4", "?5")}
  ), ranked AS (
    SELECT eligible_posts.*,
      ROW_NUMBER() OVER (PARTITION BY show_venue,date,user_id
        ORDER BY CASE WHEN overall BETWEEN 1 AND 5 THEN 0 ELSE 1 END,changed_at DESC,id DESC) AS rating_rank,
      ROW_NUMBER() OVER (PARTITION BY show_venue,date ORDER BY changed_at DESC,id DESC) AS show_rank
    FROM eligible_posts
  ), people AS (
    SELECT show_venue,date,user_id,
      MAX(CASE WHEN show_rank=1 THEN artist END) AS artist,
      MAX(CASE WHEN show_rank=1 THEN artist_key END) AS artist_key,
      MAX(CASE WHEN show_rank=1 THEN venue END) AS venue,
      MAX(CASE WHEN show_rank=1 THEN venue_key END) AS venue_key,
      MAX(CASE WHEN show_rank=1 THEN city END) AS city,
      MAX(CASE WHEN rating_rank=1 AND overall BETWEEN 1 AND 5 THEN overall END) AS rating,
      MAX(changed_at) AS latest_at
    FROM ranked GROUP BY show_venue,date,user_id
  ), concerts AS (
    SELECT show_venue,date,MAX(artist) AS artist,MAX(artist_key) AS artist_key,
      MAX(venue) AS venue,MAX(venue_key) AS venue_key,MAX(city) AS city,
      COUNT(*) AS review_count,COUNT(rating) AS rating_count,
      AVG(rating) AS average_rating,MAX(latest_at) AS latest_at
    FROM people GROUP BY show_venue,date
  )
  SELECT concerts.*,COUNT(*) OVER () AS archive_item_count FROM concerts
  ORDER BY concerts.date DESC,concerts.review_count DESC,concerts.rating_count DESC,
    concerts.average_rating DESC,concerts.latest_at DESC,concerts.show_venue
  LIMIT ?6 OFFSET ?7`);

  function readCityIdentity({ countryCode, citySlug, at }) {
    const country = requestedCountryCode(countryCode);
    const city = requestedCitySlug(citySlug);
    if (!country || !city) return null;
    const matches = resolveCity.all(at,country,city,country);
    if (matches.length !== 1) return null;
    return {
      countryCode: country,citySlug: city,
      city: String(matches[0].display_city || "").trim(),
      country: String(matches[0].display_country || country).trim() || country,
    };
  }

  function readArtistIdentity({ artistKey = null, publicSlug = null, name = null } = {}) {
    const key = String(artistKey || "").trim().toLowerCase();
    const slug = String(publicSlug || "").trim().toLowerCase();
    const displayName = String(name || "").trim();
    const rows = key ? artistByKey.all(key)
      : slug ? artistBySlug.all(slug)
        : displayName ? artistByName.all(displayName) : [];
    return rows.length === 1 ? rows[0] : null;
  }

  return Object.freeze({
    readCityVenues({ countryCode, citySlug, page = 1, limit = 12, at = Date.now(), today = null } = {}) {
      const pageNumber = requestedPage(page);
      if (!pageNumber) return null;
      const instant = requestedInstant(at);
      const day = requestedDay(today, instant);
      const identity = readCityIdentity({ countryCode,citySlug,at: instant });
      if (!identity) return null;
      const pageSize = requestedPageSize(limit);
      const rows = cityVenues.all(
        instant,day,identity.countryCode,identity.city,
        PUBLIC_ENTITY_THRESHOLDS.cityVenueItems,PUBLIC_ENTITY_THRESHOLDS.cityVenueVenues,
        pageSize + 1,(pageNumber - 1) * pageSize,
      );
      if (!rows.length) return null;
      const itemCount = Number(rows[0].city_item_count) || 0;
      const venueCount = Number(rows[0].city_venue_count) || 0;
      if (!qualifiesCityVenueDirectory({ itemCount,venueCount })) return null;
      return Object.freeze({
        kind: "city-venues",...identity,page: pageNumber,pageSize,itemCount,venueCount,
        hasNext: rows.length > pageSize,venues: Object.freeze(rows.slice(0,pageSize)),
      });
    },

    readCityConcerts({ countryCode, citySlug, page = 1, limit = 12, at = Date.now(), today = null } = {}) {
      const pageNumber = requestedPage(page);
      if (!pageNumber) return null;
      const instant = requestedInstant(at);
      const day = requestedDay(today, instant);
      const identity = readCityIdentity({ countryCode,citySlug,at: instant });
      if (!identity) return null;
      const pageSize = requestedPageSize(limit);
      const rows = cityConcerts.all(
        instant,day,identity.countryCode,identity.city,
        PUBLIC_ENTITY_THRESHOLDS.cityConcertItems,PUBLIC_ENTITY_THRESHOLDS.cityConcertVenues,
        pageSize + 1,(pageNumber - 1) * pageSize,
      );
      if (!rows.length) return null;
      const itemCount = Number(rows[0].city_item_count) || 0;
      const venueCount = Number(rows[0].city_venue_count) || 0;
      if (!qualifiesCityConcertDirectory({ itemCount,venueCount })) return null;
      return Object.freeze({
        kind: "city-concerts",...identity,page: pageNumber,pageSize,itemCount,venueCount,
        hasNext: rows.length > pageSize,concerts: Object.freeze(rows.slice(0,pageSize)),
      });
    },

    readArtistConcerts({ artistKey = null, publicSlug = null, name = null, page = 1, limit = 12, at = Date.now(), today = null } = {}) {
      const pageNumber = requestedPage(page);
      if (!pageNumber) return null;
      const artist = readArtistIdentity({ artistKey,publicSlug,name });
      if (!artist) return null;
      const instant = requestedInstant(at);
      const day = requestedDay(today, instant);
      const pageSize = requestedPageSize(limit);
      const rows = artistConcerts.all(artist.norm,artist.name,day,instant,day,
        pageSize + 1,(pageNumber - 1) * pageSize);
      if (!rows.length) return null;
      return Object.freeze({
        kind: "artist-concerts",artist,page: pageNumber,pageSize,
        itemCount: Number(rows[0].archive_item_count) || rows.length,
        hasNext: rows.length > pageSize,concerts: Object.freeze(rows.slice(0,pageSize)),
      });
    },
  });
}
