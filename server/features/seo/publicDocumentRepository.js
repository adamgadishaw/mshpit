import { activeAccountSql } from "../../accountVisibility.js";
import { archiveIdentityPart } from "../artistArchive/artistArchiveKeys.js";
import { isStrictCalendarDate, structuredShowLocationKey } from "./publicEntityPolicy.js";
import { currentOrUpcomingTourDateSql, effectiveTourDateEndSql } from "../../tourDateLifecycle.js";
import { tourDateHasNoPublishedMemorialSql } from "../../artistMemorialTourDateVisibility.js";

const bounded = (value, fallback, maximum) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
};

export const PUBLIC_POST_COLUMNS = `p.id,p.user_id,p.artist,p.artist_key,p.venue,p.city,p.date,p.overall,
  p.venue_key,p.review,p.setlist,p.tour,p.photos,p.photos_public,p.kind,p.created_at,p.updated_at,
  COALESCE(
    (SELECT canonical.public_slug FROM artists canonical WHERE canonical.norm=p.artist_key LIMIT 1),
    (SELECT legacy.public_slug FROM artists legacy
      WHERE p.artist_key IS NULL AND legacy.name=p.artist COLLATE NOCASE
        AND (SELECT COUNT(*) FROM artists legacy_identity
          WHERE legacy_identity.name=p.artist COLLATE NOCASE)=1
      ORDER BY legacy.rank_score DESC,legacy.norm LIMIT 1)
  ) AS artist_public_slug,
  u.name AS u_name,u.handle AS u_handle,u.avatar_uri AS u_avatar,
  (SELECT COUNT(*) FROM likes l JOIN users liker ON liker.id=l.user_id
    WHERE l.post_id=p.id AND ${activeAccountSql("liker")}) AS like_count,
  (SELECT COUNT(*) FROM comments c JOIN users commenter ON commenter.id=c.user_id
    WHERE c.post_id=p.id AND c.removed=0 AND ${activeAccountSql("commenter")}) AS comment_count`;

function artistPostIdentity(alias = "p") {
  return `(${alias}.artist_key=? OR (${alias}.artist_key IS NULL AND LOWER(${alias}.artist)=LOWER(?)
    AND (SELECT COUNT(*) FROM artists public_artist_identity
      WHERE public_artist_identity.name=${alias}.artist COLLATE NOCASE)=1))`;
}

// A photo/video-only review is useful directory evidence only when its linked
// asset has crossed the same owned, sanitized publication boundary used by the
// public projector. A pending upload must never make an otherwise empty page
// crawlable.
const PUBLIC_READY_MEDIA_EVIDENCE_SQL = `EXISTS (
  SELECT 1 FROM post_media linked
  JOIN media_assets asset ON asset.id=linked.asset_id AND asset.owner_id=p.user_id
  JOIN media_objects source_object
    ON source_object.owner_id=asset.owner_id AND source_object.object_key=asset.source_key
  LEFT JOIN media_variants render_variant
    ON render_variant.id=asset.render_variant_id AND render_variant.asset_id=asset.id
      AND render_variant.role='render'
  LEFT JOIN media_objects render_object
    ON render_object.owner_id=asset.owner_id AND render_object.object_key=render_variant.object_key
  WHERE linked.post_id=p.id AND asset.status='ready' AND asset.source_verified_at IS NOT NULL
    AND asset.metadata_status='declared'
    AND ((asset.kind='image' AND asset.codec_status='not_applicable') OR
      (asset.kind='video' AND asset.codec_status='verified'))
    AND source_object.status IN ('issued','associated')
    AND ((asset.kind='video' AND asset.render_state='not_required'
      AND asset.source_storage_scope='public') OR
      (asset.render_state='ready' AND render_variant.status='verified'
        AND (asset.kind!='image' OR render_variant.verification_origin='private_derivative_v1')
        AND render_object.storage_scope='public'
        AND render_object.status IN ('issued','associated')))
)`;

function noStructuredShowLocationCollisionSql(alias = "p") {
  return `NOT EXISTS (
    SELECT COUNT(DISTINCT pit_structured_show_location(public_location.venue_city,public_location.venue_country_code)) AS location_count FROM tour_dates public_location
    LEFT JOIN users public_location_owner ON public_location_owner.id=public_location.owner_id
    WHERE LOWER(TRIM(public_location.artist))=LOWER(TRIM(${alias}.artist))
      AND LOWER(TRIM(public_location.venue))=LOWER(TRIM(${alias}.venue))
      AND public_location.date=${alias}.date AND public_location.release_at<=?
      AND (public_location.owner_id IS NULL OR ${activeAccountSql("public_location_owner")})
      AND (public_location.owner_id IS NOT NULL OR COALESCE(public_location.provider_active,1)=1 OR ${effectiveTourDateEndSql("public_location")}<?)
    HAVING location_count>1
  )`;
}

/**
 * SQL-only reads for crawler-visible documents.
 *
 * This repository deliberately returns storage rows rather than API/user
 * projections. The projector is the only place that may turn those rows into
 * public values, which keeps private columns and legacy media URLs from being
 * accidentally spread into a renderer.
 */
export function createPublicDocumentRepository(database, { venueReviews = null } = {}) {
  if (!database?.prepare) throw new TypeError("Public SEO documents require a database");
  // Archive keys normalize Unicode and punctuation more carefully than SQLite's
  // LOWER(). Register that exact deterministic identity at the crawler read
  // boundary so a public concert page cannot drift from the in-app archive.
  database.function?.("pit_archive_identity", { deterministic: true }, archiveIdentityPart);
  database.function?.("pit_structured_show_location", { deterministic: true }, (city, countryCode) =>
    structuredShowLocationKey({ venue_city: city, venue_country_code: countryCode }));


  const homeArtists = database.prepare(`SELECT a.norm,a.name,a.public_slug,a.genre,a.data,a.bio,a.country,a.formed,a.updated_at,
      (SELECT COUNT(*) FROM posts rp JOIN users reviewer ON reviewer.id=rp.user_id
        WHERE rp.removed=0 AND COALESCE(rp.kind,'review')='review'
          AND (rp.artist_key=a.norm OR (rp.artist_key IS NULL AND LOWER(rp.artist)=LOWER(a.name)
            AND (SELECT COUNT(*) FROM artists home_review_identity
              WHERE home_review_identity.name=rp.artist COLLATE NOCASE)=1))
          AND ${activeAccountSql("reviewer")}) AS review_count
    FROM artists a
    WHERE LENGTH(TRIM(a.name))>0 AND (
      LENGTH(TRIM(COALESCE(a.bio,'')))>=80 OR EXISTS (
        SELECT 1 FROM posts ep JOIN users eu ON eu.id=ep.user_id
        WHERE ep.removed=0 AND COALESCE(ep.kind,'review')='review'
          AND LENGTH(TRIM(COALESCE(ep.review,'')))>=40
          AND (ep.artist_key=a.norm OR (ep.artist_key IS NULL AND LOWER(ep.artist)=LOWER(a.name)
            AND (SELECT COUNT(*) FROM artists home_evidence_identity
              WHERE home_evidence_identity.name=ep.artist COLLATE NOCASE)=1))
          AND ${activeAccountSql("eu")}
      )
    )
    ORDER BY a.rank_score DESC,a.popularity DESC,a.name COLLATE NOCASE,a.norm
    LIMIT ?`);

  const homePosts = database.prepare(`SELECT ${PUBLIC_POST_COLUMNS}
    FROM posts p JOIN users u ON u.id=p.user_id
    WHERE p.removed=0 AND ${activeAccountSql("u")}
      AND LENGTH(TRIM(COALESCE(p.review,'')))>=40
    ORDER BY p.created_at DESC,p.id DESC LIMIT ?`);

  // Discover is a stable editorial hub, not an internal search-results page.
  // Keep its inputs bounded and limited to the same privacy-safe public rows as
  // entity pages, while ranking community reviews by visible engagement.
  const discoverPosts = database.prepare(`SELECT ${PUBLIC_POST_COLUMNS}
    FROM posts p JOIN users u ON u.id=p.user_id
    WHERE p.removed=0 AND COALESCE(p.kind,'review')='review'
      AND ${activeAccountSql("u")}
      AND LENGTH(TRIM(COALESCE(p.review,'')))>=40
    ORDER BY (like_count+comment_count) DESC,p.created_at DESC,p.id DESC LIMIT ?`);

  const artistByKey = database.prepare(`SELECT norm,name,public_slug,genre,data,bio,mbid,country,formed,updated_at
    FROM artists WHERE norm=? LIMIT 1`);
  const artistByName = database.prepare(`SELECT norm,name,public_slug,genre,data,bio,mbid,country,formed,updated_at
    FROM artists WHERE LOWER(name)=LOWER(?) ORDER BY rank_score DESC,norm LIMIT 1`);
  const artistProfile = database.prepare(`SELECT ap.bio,ap.banner,ap.avatar_uri,ap.feed_enabled,
      ap.owner_id,ap.updated_at
    FROM artist_profiles ap JOIN users owner ON owner.id=ap.owner_id
    WHERE ap.artist_key=? AND ap.removed=0 AND ${activeAccountSql("owner")} LIMIT 1`);
  const artistReviews = database.prepare(`SELECT ${PUBLIC_POST_COLUMNS}
    FROM posts p JOIN users u ON u.id=p.user_id
    WHERE p.removed=0 AND COALESCE(p.kind,'review')='review'
      AND (LENGTH(TRIM(COALESCE(p.review,'')))>=40 OR (
        p.photos_public=1 AND EXISTS (SELECT 1 FROM post_media media WHERE media.post_id=p.id)
      ))
      AND ${artistPostIdentity("p")} AND ${activeAccountSql("u")}
    ORDER BY (like_count+comment_count) DESC,p.overall DESC,
      CASE WHEN p.date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' THEN p.date ELSE '' END DESC,
      p.created_at DESC,p.id ASC LIMIT ?`);
  const artistReviewStats = database.prepare(`SELECT COUNT(*) AS review_count,AVG(CASE WHEN p.overall BETWEEN 1 AND 5 THEN p.overall END) AS average_rating,
      MAX(COALESCE(p.updated_at,p.created_at)) AS latest_at
    FROM posts p JOIN users u ON u.id=p.user_id
    WHERE p.removed=0 AND COALESCE(p.kind,'review')='review'
      AND LENGTH(TRIM(COALESCE(p.review,'')))>=40
      AND ${artistPostIdentity("p")} AND ${activeAccountSql("u")}`);
  const artistUpdates = database.prepare(`SELECT post.id,post.user_id,post.text,post.created_at,
      author.name AS u_name,author.handle AS u_handle
    FROM artist_posts post JOIN users author ON author.id=post.user_id
    WHERE post.artist_key=? AND post.removed=0 AND ${activeAccountSql("author")}
    ORDER BY post.created_at DESC,post.id DESC LIMIT ?`);
  const artistEvents = database.prepare(`SELECT td.id,td.provider_event_id,td.event_name,td.artist,
      td.venue,td.venue_provider_id,td.place,td.lat,td.lng,td.date,td.start_date_time,
      td.start_local_time,td.event_timezone,td.event_status,td.ticket_url,td.sold_out,
      td.event_kind,td.music_evidence,td.billed_artists,td.event_end_date,
      td.source,td.updated_at,td.owner_id,td.venue_address_line1,td.venue_address_line2,
      td.venue_city,td.venue_region,td.venue_postal_code,td.venue_country_code,td.venue_country,
      a.norm AS artist_key,a.public_slug AS artist_public_slug
    FROM tour_dates td LEFT JOIN artists a ON a.norm=td.artist_key
    WHERE (td.artist_key=? OR (td.artist_key IS NULL AND LOWER(td.artist)=LOWER(?)
        AND (SELECT COUNT(*) FROM artists event_artist_identity
          WHERE event_artist_identity.name=td.artist COLLATE NOCASE)=1))
      AND td.release_at<=? AND ${currentOrUpcomingTourDateSql("td")}
      AND ${tourDateHasNoPublishedMemorialSql("td")}
      AND COALESCE(td.music_qualified,1)=1
      AND (td.owner_id IS NOT NULL OR COALESCE(td.provider_active,1)=1)
      AND td.date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND (td.owner_id IS NULL OR EXISTS (
        SELECT 1 FROM users event_owner WHERE event_owner.id=td.owner_id
          AND ${activeAccountSql("event_owner")}
      ))
    ORDER BY td.date ASC,td.id ASC LIMIT ?`);

  const artistConcerts = database.prepare(`WITH eligible AS (
    SELECT p.*,
      pit_archive_identity(COALESCE(NULLIF(TRIM(p.venue_key),''),p.venue)) AS show_venue,
      COALESCE(p.updated_at,p.created_at) AS changed_at
    FROM posts p JOIN users u ON u.id=p.user_id
    WHERE p.removed=0 AND COALESCE(p.kind,'review')='review'
      AND p.date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(p.date)=p.date AND p.date<=?
      AND (LENGTH(TRIM(COALESCE(p.review,'')))>=40 OR (
        p.photos_public=1 AND ${PUBLIC_READY_MEDIA_EVIDENCE_SQL}
      ))
      AND ${artistPostIdentity("p")} AND ${activeAccountSql("u")}
      AND ${noStructuredShowLocationCollisionSql("p")}
  ), ranked AS (
    SELECT eligible.*,
      ROW_NUMBER() OVER (
        PARTITION BY show_venue,date,user_id
        ORDER BY CASE WHEN overall BETWEEN 1 AND 5 THEN 0 ELSE 1 END,
          changed_at DESC,id DESC
      ) AS rating_rank,
      ROW_NUMBER() OVER (
        PARTITION BY show_venue,date
        ORDER BY changed_at DESC,id DESC
      ) AS show_rank
    FROM eligible
  ), people AS (
    SELECT show_venue,date,user_id,
      MAX(CASE WHEN show_rank=1 THEN artist END) AS artist,
      MAX(CASE WHEN show_rank=1 THEN artist_key END) AS artist_key,
      MAX(CASE WHEN show_rank=1 THEN venue END) AS venue,
      MAX(CASE WHEN show_rank=1 THEN venue_key END) AS venue_key,
      MAX(CASE WHEN show_rank=1 THEN city END) AS city,
      MAX(CASE WHEN rating_rank=1 AND overall BETWEEN 1 AND 5 THEN overall END) AS rating,
      MAX(changed_at) AS latest_at
    FROM ranked
    GROUP BY show_venue,date,user_id
  )
  SELECT MAX(artist) AS artist,
    MAX(artist_key) AS artist_key,
    MAX(venue) AS venue,
    MAX(venue_key) AS venue_key,
    MAX(city) AS city,
    date,
    COUNT(rating) AS rating_count,
    AVG(rating) AS average_rating,
    COUNT(*) AS review_count,
    MAX(latest_at) AS latest_at,
    COUNT(*) OVER () AS archive_item_count
  FROM people
  GROUP BY show_venue,date
  ORDER BY rating_count DESC,average_rating DESC,review_count DESC,latest_at DESC
  LIMIT ?`);

  const eventById = database.prepare(`SELECT td.*,a.norm AS artist_key,a.public_slug AS artist_public_slug,
      a.genre AS artist_genre,a.bio AS artist_bio,a.updated_at AS artist_updated_at
    FROM tour_dates td LEFT JOIN artists a ON a.norm=td.artist_key
      OR (td.artist_key IS NULL AND a.norm=LOWER(TRIM(td.artist)))
    LEFT JOIN users owner ON owner.id=td.owner_id
    WHERE td.id=? AND td.release_at<=?
      AND COALESCE(td.music_qualified,1)=1
      AND (td.owner_id IS NULL OR ${activeAccountSql("owner")})
      AND (td.owner_id IS NOT NULL OR COALESCE(td.provider_active,1)=1 OR ${effectiveTourDateEndSql("td")}<?)
      AND (${effectiveTourDateEndSql("td")}<? OR ${tourDateHasNoPublishedMemorialSql("td")})
    LIMIT 1`);

  const eventRelatedPosts = database.prepare(`SELECT ${PUBLIC_POST_COLUMNS}
    FROM posts p JOIN users u ON u.id=p.user_id
    WHERE p.removed=0 AND COALESCE(p.kind,'review')='review'
      AND (p.artist_key=? OR (p.artist_key IS NULL AND LOWER(p.artist)=LOWER(?)
        AND (SELECT COUNT(*) FROM artists related_artist_identity
          WHERE related_artist_identity.name=p.artist COLLATE NOCASE)<=1))
      AND LOWER(p.venue)=LOWER(?) AND p.date=?
      AND (LENGTH(TRIM(COALESCE(p.review,'')))>=40 OR EXISTS (
        SELECT 1 FROM post_media media WHERE media.post_id=p.id
      )) AND ${activeAccountSql("u")}
    ORDER BY (like_count+comment_count) DESC,p.created_at DESC,p.id ASC LIMIT ?`);

  const concertReviews = database.prepare(`SELECT ${PUBLIC_POST_COLUMNS}
    FROM posts p JOIN users u ON u.id=p.user_id
    WHERE p.removed=0 AND COALESCE(p.kind,'review')='review'
      AND pit_archive_identity(COALESCE(NULLIF(TRIM(p.artist_key),''),p.artist))=?
      AND pit_archive_identity(COALESCE(NULLIF(TRIM(p.venue_key),''),p.venue))=?
      AND p.date=? AND ${activeAccountSql("u")}
      AND (LENGTH(TRIM(COALESCE(p.review,'')))>=40 OR (p.photos_public=1 AND EXISTS (
        SELECT 1 FROM post_media media WHERE media.post_id=p.id
      )))
    ORDER BY (like_count+comment_count) DESC,p.created_at DESC,p.id ASC LIMIT ?`);

  // Public archive statistics count eligible people, not posts. When one member
  // contributes more than once to a show, their latest valid rating is the one
  // rating that carries weight; a newer invalid legacy value cannot erase it.
  const concertReviewStats = database.prepare(`WITH eligible AS (
    SELECT p.id,p.user_id,p.overall,
      COALESCE(p.updated_at,p.created_at) AS changed_at
    FROM posts p JOIN users u ON u.id=p.user_id
    WHERE p.removed=0 AND COALESCE(p.kind,'review')='review'
      AND pit_archive_identity(COALESCE(NULLIF(TRIM(p.artist_key),''),p.artist))=?
      AND pit_archive_identity(COALESCE(NULLIF(TRIM(p.venue_key),''),p.venue))=?
      AND p.date=? AND ${activeAccountSql("u")}
      AND (LENGTH(TRIM(COALESCE(p.review,'')))>=40 OR (p.photos_public=1 AND EXISTS (
        SELECT 1 FROM post_media media WHERE media.post_id=p.id
      )))
  ), ranked AS (
    SELECT eligible.*,
      ROW_NUMBER() OVER (
        PARTITION BY user_id
        ORDER BY CASE WHEN overall BETWEEN 1 AND 5 THEN 0 ELSE 1 END,
          changed_at DESC,id DESC
      ) AS rating_rank
    FROM eligible
  )
  SELECT COUNT(DISTINCT user_id) AS review_count,
    COUNT(DISTINCT CASE WHEN rating_rank=1 AND overall BETWEEN 1 AND 5 THEN user_id END) AS rating_count,
    AVG(CASE WHEN rating_rank=1 AND overall BETWEEN 1 AND 5 THEN overall END) AS average_rating,
    MAX(changed_at) AS latest_at
  FROM ranked`);

  const concertStructuredLocations = database.prepare(`SELECT
      COUNT(DISTINCT pit_structured_show_location(td.venue_city,td.venue_country_code)) AS location_count
    FROM tour_dates td LEFT JOIN users location_owner ON location_owner.id=td.owner_id
    WHERE LOWER(TRIM(td.artist))=LOWER(TRIM(?)) AND LOWER(TRIM(td.venue))=LOWER(TRIM(?))
      AND td.date=? AND td.release_at<=?
      AND COALESCE(td.music_qualified,1)=1
      AND (td.owner_id IS NULL OR ${activeAccountSql("location_owner")})
      AND (td.owner_id IS NOT NULL OR COALESCE(td.provider_active,1)=1 OR ${effectiveTourDateEndSql("td")}<?)`);

  const concertEvent = database.prepare(`SELECT td.*,a.norm AS artist_key,a.public_slug AS artist_public_slug
    FROM tour_dates td
    LEFT JOIN users owner ON owner.id=td.owner_id
    LEFT JOIN artists a ON a.norm=LOWER(TRIM(td.artist))
    WHERE pit_archive_identity(td.artist)=?
      AND pit_archive_identity(td.venue)=?
      AND td.date=? AND td.release_at<=?
      AND COALESCE(td.music_qualified,1)=1
      AND (td.owner_id IS NULL OR ${activeAccountSql("owner")})
      AND (td.owner_id IS NOT NULL OR COALESCE(td.provider_active,1)=1 OR ${effectiveTourDateEndSql("td")}<?)
    ORDER BY
      CASE WHEN TRIM(COALESCE(td.venue_address_line1,''))<>'' THEN 0
        WHEN TRIM(COALESCE(td.venue_city,''))<>''
          AND TRIM(COALESCE(td.venue_country_code,td.venue_country,''))<>'' THEN 1
        ELSE 2 END,
      td.updated_at DESC,td.id ASC
    LIMIT 1`);

  const venuePostsByName = database.prepare(`SELECT ${PUBLIC_POST_COLUMNS}
    FROM posts p JOIN users u ON u.id=p.user_id
    WHERE p.removed=0 AND COALESCE(p.kind,'review')='review'
      AND (p.venue_key=? OR (p.venue_key IS NULL AND LOWER(p.venue)=LOWER(?)))
      AND (LENGTH(TRIM(COALESCE(p.review,'')))>=40 OR EXISTS (
        SELECT 1 FROM post_media media WHERE media.post_id=p.id
      )) AND ${activeAccountSql("u")}
    ORDER BY (like_count+comment_count) DESC,p.created_at DESC,p.id ASC LIMIT ?`);

  const venueEventsByName = database.prepare(`SELECT td.*,a.norm AS artist_key,a.public_slug AS artist_public_slug FROM tour_dates td
    LEFT JOIN users owner ON owner.id=td.owner_id
    LEFT JOIN artists a ON a.norm=LOWER(TRIM(td.artist))
    WHERE LOWER(td.venue)=LOWER(?)
      AND td.release_at<=? AND ${currentOrUpcomingTourDateSql("td")}
      AND ${tourDateHasNoPublishedMemorialSql("td")}
      AND COALESCE(td.music_qualified,1)=1
      AND (td.owner_id IS NULL OR ${activeAccountSql("owner")})
      AND (td.owner_id IS NOT NULL OR COALESCE(td.provider_active,1)=1)
    ORDER BY td.date ASC,td.id ASC LIMIT ?`);

  const venueEventsByProvider = database.prepare(`SELECT td.*,a.norm AS artist_key,a.public_slug AS artist_public_slug FROM tour_dates td
    LEFT JOIN users owner ON owner.id=td.owner_id
    LEFT JOIN artists a ON a.norm=LOWER(TRIM(td.artist))
    WHERE td.source IS ? AND td.venue_provider_id=?
      AND td.release_at<=? AND ${currentOrUpcomingTourDateSql("td")}
      AND ${tourDateHasNoPublishedMemorialSql("td")}
      AND COALESCE(td.music_qualified,1)=1
      AND (td.owner_id IS NULL OR ${activeAccountSql("owner")})
      AND (td.owner_id IS NOT NULL OR COALESCE(td.provider_active,1)=1)
    ORDER BY td.date ASC,td.id ASC LIMIT ?`);

  const directoryArtists = database.prepare(`SELECT a.norm,a.name,a.public_slug,a.genre,a.data,a.bio,a.updated_at,
      COUNT(*) OVER () AS directory_total
    FROM artists a
    WHERE a.public_slug IS NOT NULL AND TRIM(a.public_slug)<>'' AND (
      LENGTH(TRIM(COALESCE(a.bio,'')))>=80 OR EXISTS (
        SELECT 1 FROM posts p JOIN users reviewer ON reviewer.id=p.user_id
        WHERE p.removed=0 AND COALESCE(p.kind,'review')='review'
          AND (LENGTH(TRIM(COALESCE(p.review,'')))>=40 OR (
            p.photos_public=1 AND EXISTS (SELECT 1 FROM post_media media WHERE media.post_id=p.id)
          ))
          AND (p.artist_key=a.norm OR (p.artist_key IS NULL AND LOWER(p.artist)=LOWER(a.name)
            AND (SELECT COUNT(*) FROM artists directory_review_identity
              WHERE directory_review_identity.name=p.artist COLLATE NOCASE)=1))
          AND ${activeAccountSql("reviewer")}
      ) OR EXISTS (
        SELECT 1 FROM tour_dates td
        WHERE (td.artist_key=a.norm OR (td.artist_key IS NULL AND LOWER(TRIM(td.artist))=LOWER(TRIM(a.name))
          AND (SELECT COUNT(*) FROM artists directory_event_identity
            WHERE directory_event_identity.name=td.artist COLLATE NOCASE)=1))
          AND td.release_at<=? AND ${currentOrUpcomingTourDateSql("td")}
          AND ${tourDateHasNoPublishedMemorialSql("td")}
          AND COALESCE(td.music_qualified,1)=1
          AND td.date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
          AND (td.owner_id IS NOT NULL OR COALESCE(td.provider_active,1)=1)
          AND (td.owner_id IS NULL OR EXISTS (
            SELECT 1 FROM users event_owner WHERE event_owner.id=td.owner_id
              AND ${activeAccountSql("event_owner")}
          ))
      )
    )
    ORDER BY a.rank_score DESC,a.popularity DESC,a.name COLLATE NOCASE,a.norm LIMIT ? OFFSET ?`);

  const directoryEvents = database.prepare(`SELECT td.*,a.norm AS artist_key,a.public_slug AS artist_public_slug,
      COUNT(*) OVER () AS directory_total FROM tour_dates td
    LEFT JOIN users owner ON owner.id=td.owner_id
    LEFT JOIN artists a ON a.norm=LOWER(TRIM(td.artist))
    WHERE td.release_at<=? AND ${currentOrUpcomingTourDateSql("td")}
      AND ${tourDateHasNoPublishedMemorialSql("td")}
      AND COALESCE(td.music_qualified,1)=1
      AND td.date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND TRIM(COALESCE(td.artist,''))<>'' AND TRIM(COALESCE(td.venue,''))<>''
      AND (td.owner_id IS NULL OR ${activeAccountSql("owner")})
      AND (td.owner_id IS NOT NULL OR COALESCE(td.provider_active,1)=1)
    ORDER BY td.date ASC,td.id ASC LIMIT ? OFFSET ?`);

  const directoryVenues = database.prepare(`WITH canonical_event_rows AS (
    SELECT LOWER(TRIM(td.venue)) AS venue_name,
      CASE WHEN TRIM(COALESCE(td.venue_provider_id,''))<>'' THEN 1 ELSE 0 END AS has_provider,
      LOWER(TRIM(COALESCE(td.venue_city,''))) AS city_identity,
      UPPER(TRIM(COALESCE(td.venue_country_code,''))) AS country_identity,
      CASE WHEN TRIM(COALESCE(td.venue_city,''))='' OR
        UPPER(TRIM(COALESCE(td.venue_country_code,''))) NOT GLOB '[A-Z][A-Z]'
        THEN 1 ELSE 0 END AS is_unstructured
    FROM tour_dates td
    LEFT JOIN users canonical_owner ON canonical_owner.id=td.owner_id
    WHERE td.release_at<=? AND TRIM(COALESCE(td.venue,''))<>''
      AND COALESCE(td.music_qualified,1)=1
      AND (td.owner_id IS NULL OR ${activeAccountSql("canonical_owner")})
      AND (td.owner_id IS NOT NULL OR COALESCE(td.provider_active,1)=1 OR ${effectiveTourDateEndSql("td")}<?)
  ), venue_name_quality AS (
    SELECT venue_name,
      COUNT(DISTINCT CASE WHEN is_unstructured=0
        THEN country_identity||'|'||city_identity END) AS structured_identity_count,
      MAX(is_unstructured) AS has_unstructured,
      MAX(has_provider) AS has_provider
    FROM canonical_event_rows
    GROUP BY venue_name
  ), post_location_quality AS (
    SELECT LOWER(TRIM(p.venue)) AS venue_name,
      COUNT(DISTINCT LOWER(TRIM(COALESCE(p.city,'')))) AS location_count,
      MAX(CASE WHEN TRIM(COALESCE(p.city,''))='' THEN 1 ELSE 0 END) AS has_blank,
      MIN(LOWER(TRIM(COALESCE(p.city,'')))) AS location_identity
    FROM posts p JOIN users identity_author ON identity_author.id=p.user_id
    WHERE p.removed=0 AND TRIM(COALESCE(p.venue,''))<>''
      AND ${activeAccountSql("identity_author")}
    GROUP BY LOWER(TRIM(p.venue))
  ), eligible_events AS (
    SELECT CASE
        WHEN TRIM(COALESCE(td.venue_provider_id,''))<>'' THEN
          'provider:'||LOWER(TRIM(COALESCE(td.source,'')))||':'||LOWER(TRIM(td.venue_provider_id))
        ELSE 'name:'||LOWER(TRIM(td.venue))
      END AS venue_identity,
      td.venue AS name,td.source,td.venue_provider_id,td.place,td.venue_city,td.venue_region,
      td.venue_country_code,td.venue_country,td.id AS event_id,td.event_name,
      td.artist AS featured_artist,a.norm AS featured_artist_key,
      a.public_slug AS featured_artist_public_slug,td.date AS event_date,
      td.start_date_time AS event_start_date_time,td.start_local_time AS event_local_time,
      td.event_timezone,td.event_status,td.ticket_url AS event_ticket_url,td.sold_out AS event_sold_out,
      td.venue_address_line1,td.venue_address_line2,td.venue_postal_code,td.updated_at
    FROM tour_dates td
    LEFT JOIN users owner ON owner.id=td.owner_id
    LEFT JOIN artists a ON a.norm=LOWER(TRIM(td.artist))
    LEFT JOIN venue_name_quality quality ON quality.venue_name=LOWER(TRIM(td.venue))
    LEFT JOIN post_location_quality post_quality ON post_quality.venue_name=LOWER(TRIM(td.venue))
    WHERE td.release_at<=? AND ${currentOrUpcomingTourDateSql("td")} AND date(td.date)=td.date
      AND ${tourDateHasNoPublishedMemorialSql("td")}
      AND COALESCE(td.music_qualified,1)=1
      AND TRIM(COALESCE(td.artist,''))<>'' AND TRIM(COALESCE(td.venue,''))<>''
      AND (td.owner_id IS NULL OR ${activeAccountSql("owner")})
      AND (td.owner_id IS NOT NULL OR COALESCE(td.provider_active,1)=1)
      AND (TRIM(COALESCE(td.venue_provider_id,''))<>'' OR (
        quality.structured_identity_count=1
        AND quality.has_unstructured=0
        AND quality.has_provider=0
        AND TRIM(COALESCE(td.venue_city,''))<>''
        AND UPPER(TRIM(COALESCE(td.venue_country_code,''))) GLOB '[A-Z][A-Z]'
        AND (post_quality.venue_name IS NULL OR (
          post_quality.location_count=1 AND post_quality.has_blank=0
          AND post_quality.location_identity=LOWER(TRIM(td.venue_city))
        ))
      ))
  ), event_candidates AS (
    SELECT eligible_events.*,
      ROW_NUMBER() OVER (
        PARTITION BY venue_identity
        ORDER BY event_date ASC,event_id ASC
      ) AS event_rank
    FROM eligible_events
  ), review_evidence AS (
    SELECT 'name:'||LOWER(TRIM(p.venue)) AS venue_identity,
      p.venue AS name,p.city,p.artist AS featured_artist,p.artist_key AS featured_artist_key,
      a.public_slug AS featured_artist_public_slug,
      COALESCE(p.updated_at,p.created_at) AS changed_at,p.id,
      COUNT(*) OVER (PARTITION BY LOWER(TRIM(p.venue))) AS review_count,
      ROW_NUMBER() OVER (
        PARTITION BY LOWER(TRIM(p.venue))
        ORDER BY COALESCE(p.updated_at,p.created_at) DESC,p.id DESC
      ) AS review_rank
    FROM posts p
    JOIN users author ON author.id=p.user_id
    LEFT JOIN artists a ON a.norm=p.artist_key
    WHERE p.removed=0 AND COALESCE(p.kind,'review')='review'
      AND TRIM(COALESCE(p.venue,''))<>''
      AND (LENGTH(TRIM(COALESCE(p.review,'')))>=40 OR
        (p.photos_public=1 AND ${PUBLIC_READY_MEDIA_EVIDENCE_SQL}))
      AND ${activeAccountSql("author")}
  ), first_events AS (
    SELECT * FROM event_candidates WHERE event_rank=1
  ), first_reviews AS (
    SELECT * FROM review_evidence WHERE review_rank=1
  ), combined AS (
    SELECT e.venue_identity,e.name,e.source,e.venue_provider_id,e.place,e.venue_city,
      e.venue_region,e.venue_country_code,e.venue_country,e.event_id,e.event_name,
      e.featured_artist,e.featured_artist_key,e.featured_artist_public_slug,e.event_date,
      e.event_start_date_time,e.event_local_time,e.event_timezone,e.event_status,
      e.event_ticket_url,e.event_sold_out,e.venue_address_line1,e.venue_address_line2,
      e.venue_postal_code,
      CASE WHEN COALESCE(r.changed_at,0)>COALESCE(e.updated_at,0)
        THEN r.changed_at ELSE e.updated_at END AS updated_at,
      COALESCE(r.review_count,0) AS review_count,0 AS sort_kind
    FROM first_events e
    LEFT JOIN first_reviews r
      ON e.venue_provider_id IS NULL AND r.venue_identity=e.venue_identity
        AND LOWER(TRIM(r.city))=LOWER(TRIM(e.venue_city))
  )
  SELECT combined.*,COUNT(*) OVER () AS directory_total FROM combined
  ORDER BY sort_kind ASC,event_date ASC,review_count DESC,name COLLATE NOCASE,venue_identity
  LIMIT ? OFFSET ?`);

  const directoryConcerts = database.prepare(`WITH eligible AS (
    SELECT p.*,
      pit_archive_identity(COALESCE(NULLIF(TRIM(p.artist_key),''),p.artist)) AS show_artist,
      pit_archive_identity(COALESCE(NULLIF(TRIM(p.venue_key),''),p.venue)) AS show_venue,
      COALESCE(p.updated_at,p.created_at) AS changed_at
    FROM posts p JOIN users author ON author.id=p.user_id
    WHERE p.removed=0 AND COALESCE(p.kind,'review')='review'
      AND p.date<=? AND date(p.date)=p.date
      AND TRIM(COALESCE(p.artist,''))<>'' AND TRIM(COALESCE(p.venue,''))<>''
      AND (LENGTH(TRIM(COALESCE(p.review,'')))>=40 OR
        (p.photos_public=1 AND ${PUBLIC_READY_MEDIA_EVIDENCE_SQL}))
      AND ${activeAccountSql("author")}
      AND ${noStructuredShowLocationCollisionSql("p")}
  ), ranked AS (
    SELECT eligible.*,
      ROW_NUMBER() OVER (
        PARTITION BY show_artist,show_venue,date,user_id
        ORDER BY CASE WHEN overall BETWEEN 1 AND 5 THEN 0 ELSE 1 END,
          changed_at DESC,id DESC
      ) AS rating_rank,
      ROW_NUMBER() OVER (
        PARTITION BY show_artist,show_venue,date
        ORDER BY changed_at DESC,id DESC
      ) AS show_rank
    FROM eligible
  ), people AS (
    SELECT show_artist,show_venue,date,user_id,
      MAX(CASE WHEN show_rank=1 THEN artist END) AS artist,
      MAX(CASE WHEN show_rank=1 THEN artist_key END) AS artist_key,
      MAX(CASE WHEN show_rank=1 THEN venue END) AS venue,
      MAX(CASE WHEN show_rank=1 THEN venue_key END) AS venue_key,
      MAX(CASE WHEN show_rank=1 THEN city END) AS city,
      MAX(CASE WHEN rating_rank=1 AND overall BETWEEN 1 AND 5 THEN overall END) AS rating,
      MAX(changed_at) AS latest_at
    FROM ranked
    GROUP BY show_artist,show_venue,date,user_id
  ), concerts AS (
    SELECT show_artist,show_venue,date,
      MAX(artist) AS artist,MAX(artist_key) AS artist_key,
      MAX(venue) AS venue,MAX(venue_key) AS venue_key,MAX(city) AS city,
      COUNT(rating) AS rating_count,AVG(rating) AS average_rating,
      COUNT(*) AS review_count,MAX(latest_at) AS latest_at
    FROM people
    GROUP BY show_artist,show_venue,date
  )
  SELECT concerts.*,a.public_slug AS artist_public_slug,COUNT(*) OVER () AS directory_total
  FROM concerts
  LEFT JOIN artists a ON a.norm=concerts.artist_key
  ORDER BY concerts.date DESC,concerts.review_count DESC,concerts.rating_count DESC,
    concerts.average_rating DESC,concerts.latest_at DESC,concerts.show_artist,concerts.show_venue
  LIMIT ? OFFSET ?`);

  const memberByHandle = database.prepare(`SELECT u.id,u.name,u.handle,u.artist_name,u.bio,
      u.avatar_uri,u.banner,u.created_at
    FROM users u WHERE u.handle=? AND ${activeAccountSql("u")} LIMIT 1`);
  const memberById = database.prepare(`SELECT u.id,u.name,u.handle,u.artist_name,u.bio,
      u.avatar_uri,u.banner,u.created_at
    FROM users u WHERE u.id=? AND ${activeAccountSql("u")} LIMIT 1`);
  const memberPosts = database.prepare(`SELECT ${PUBLIC_POST_COLUMNS}
    FROM posts p JOIN users u ON u.id=p.user_id
    WHERE p.user_id=? AND p.removed=0 AND ${activeAccountSql("u")}
      AND (LENGTH(TRIM(COALESCE(p.review,'')))>=40 OR (
        p.photos_public=1 AND EXISTS (SELECT 1 FROM post_media media WHERE media.post_id=p.id)
      ))
    ORDER BY p.created_at DESC,p.id DESC LIMIT ?`);
  const memberStats = database.prepare(`SELECT
      (SELECT COUNT(*) FROM posts p WHERE p.user_id=u.id AND p.removed=0
        AND LENGTH(TRIM(COALESCE(p.review,'')))>=40) AS post_count,
      (SELECT COUNT(*) FROM follows f JOIN users follower ON follower.id=f.follower_id
        WHERE f.followee_id=u.id AND ${activeAccountSql("follower")}) AS follower_count
    FROM users u WHERE u.id=? AND ${activeAccountSql("u")}`);

  const postById = database.prepare(`SELECT ${PUBLIC_POST_COLUMNS}
    FROM posts p JOIN users u ON u.id=p.user_id
    WHERE p.id=? AND p.removed=0 AND ${activeAccountSql("u")} LIMIT 1`);
  const postComments = database.prepare(`SELECT c.id,c.parent_id,c.text,c.created_at,
      author.id AS user_id,author.name AS u_name,author.handle AS u_handle,
      author.avatar_uri AS u_avatar
    FROM comments c JOIN users author ON author.id=c.user_id
    WHERE c.post_id=? AND c.removed=0 AND ${activeAccountSql("author")}
    ORDER BY c.created_at ASC,c.id ASC LIMIT ?`);
  const postCommentCount = database.prepare(`SELECT COUNT(*) AS total
    FROM comments c JOIN users author ON author.id=c.user_id
    WHERE c.post_id=? AND c.removed=0 AND ${activeAccountSql("author")}`);

  function readArtistRecord({ artistKey = null, name = null } = {}) {
    const key = typeof artistKey === "string" ? artistKey.trim().toLowerCase() : "";
    const displayName = typeof name === "string" ? name.trim() : "";
    if (key) return artistByKey.get(key) || null;
    return displayName ? artistByName.get(displayName) || null : null;
  }

  return Object.freeze({
    readHome({ artistLimit = 6, postLimit = 6 } = {}) {
      const artists = homeArtists.all(bounded(artistLimit, 6, 12));
      return { artists, posts: homePosts.all(bounded(postLimit, 6, 12)) };
    },

    readDiscover({ artistLimit = 12, eventLimit = 24, postLimit = 8, at = Date.now(), today = null } = {}) {
      const instant = Number.isFinite(Number(at)) ? Number(at) : Date.now();
      const day = typeof today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(today)
        ? today : new Date(instant).toISOString().slice(0, 10);
      return {
        artists: directoryArtists.all(instant, day, bounded(artistLimit, 12, 24), 0),
        events: directoryEvents.all(instant, day, bounded(eventLimit, 24, 48), 0),
        posts: discoverPosts.all(bounded(postLimit, 8, 16)),
      };
    },

    readArtist({ artistKey = null, name = null, reviewLimit = 3, updateLimit = 3, eventLimit = 3, concertLimit = 3, at = Date.now(), today = null } = {}) {
      const artist = readArtistRecord({ artistKey, name });
      if (!artist) return null;
      const identityArgs = [artist.norm, artist.name];
      const profile = artistProfile.get(artist.norm) || null;
      const updates = profile?.feed_enabled
        ? artistUpdates.all(artist.norm, bounded(updateLimit, 3, 6))
        : [];
      const instant = Number.isFinite(Number(at)) ? Number(at) : Date.now();
      const day = typeof today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(today)
        ? today
        : new Date(instant).toISOString().slice(0, 10);
      return {
        artist,
        profile,
        reviews: artistReviews.all(...identityArgs, bounded(reviewLimit, 3, 6)),
        stats: artistReviewStats.get(...identityArgs) || null,
        updates,
        events: artistEvents.all(...identityArgs, instant, day, bounded(eventLimit, 3, 6)),
        concerts: artistConcerts.all(day, ...identityArgs, instant, day, bounded(concertLimit, 3, 3)),
      };
    },

    readMember({ id = null, handle = null, postLimit = 8 } = {}) {
      const memberId = typeof id === "string" ? id.trim() : "";
      const memberHandle = typeof handle === "string" ? handle.replace(/^@+/, "").trim().toLowerCase() : "";
      const member = memberId
        ? memberById.get(memberId) || null
        : memberHandle ? memberByHandle.get(memberHandle) || null : null;
      if (!member) return null;
      return {
        member,
        stats: memberStats.get(member.id) || null,
        posts: memberPosts.all(member.id, bounded(postLimit, 8, 12)),
      };
    },

    readPost({ id, commentLimit = 20 } = {}) {
      const postId = typeof id === "string" ? id.trim() : "";
      if (!postId) return null;
      const post = postById.get(postId) || null;
      if (!post) return null;
      return {
        post,
        comments: postComments.all(post.id, bounded(commentLimit, 20, 50)),
        commentCount: Math.max(0, Math.trunc(Number(postCommentCount.get(post.id)?.total) || 0)),
      };
    },

    readEvent({ id, relatedLimit = 6, at = Date.now(), today = null } = {}) {
      const eventId = typeof id === "string" ? id.trim() : "";
      if (!eventId) return null;
      const instant = Number.isFinite(Number(at)) ? Number(at) : Date.now();
      const day = typeof today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(today)
        ? today : new Date(instant).toISOString().slice(0, 10);
      const event = eventById.get(eventId, instant, day, day) || null;
      if (!event) return null;
      return {
        event,
        posts: eventRelatedPosts.all(event.artist_key || "", event.artist, event.venue, event.date,
          bounded(relatedLimit, 6, 12)),
      };
    },

    readConcert({ artistIdentity, venueIdentity, date, reviewLimit = 12 } = {}) {
      if (!artistIdentity || !venueIdentity || !/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) return null;
      const artistKey = archiveIdentityPart(artistIdentity);
      const venueKey = archiveIdentityPart(venueIdentity);
      const reviews = concertReviews.all(
        artistKey, venueKey, date,
        bounded(reviewLimit, 12, 30),
      );
      const stats = concertReviewStats.get(artistKey, venueKey, date) || null;
      if (!stats || Math.max(0, Math.trunc(Number(stats.review_count) || 0)) < 1) return null;
      const at = Date.now();
      const today = new Date(at).toISOString().slice(0, 10);
      const representative = reviews[0];
      if (!representative) return null;
      const locationCount = Number(concertStructuredLocations.get(
        representative.artist, representative.venue, date, at, today,
      )?.location_count) || 0;
      if (locationCount > 1) return null;
      return {
        reviews,
        stats,
        event: concertEvent.get(artistKey, venueKey, date, at, today) || null,
      };
    },

    readVenue({ venueKey = null, name, providerVenueId = null, source = null, postLimit = 8, eventLimit = 8, at = Date.now(), today = null } = {}) {
      const venueName = typeof name === "string" ? name.trim() : "";
      const key = typeof venueKey === "string" && venueKey.trim() ? venueKey.trim() : venueName.toLowerCase();
      if (!venueName || !key) return null;
      const instant = Number.isFinite(Number(at)) ? Number(at) : Date.now();
      const day = typeof today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(today)
        ? today : new Date(instant).toISOString().slice(0, 10);
      const providerId = typeof providerVenueId === "string" ? providerVenueId.trim() : "";
      const providerSource = typeof source === "string" && source.trim() ? source.trim() : null;
      const posts = providerId
        ? []
        : venuePostsByName.all(key, venueName, bounded(postLimit, 8, 16));
      const events = providerId
        ? venueEventsByProvider.all(providerSource, providerId, instant, day, bounded(eventLimit, 8, 16))
        : venueEventsByName.all(venueName, instant, day, bounded(eventLimit, 8, 16));
      return {
        venue: { key, name: venueName, providerVenueId: providerId || null, source: providerSource },
        posts,
        events,
        venueReviews: venueReviews?.read({ venueKey: key, limit: 8 }) || {
          reviews: [],
          stats: { reviewCount: 0, ratingCount: 0, averageRating: null },
        },
      };
    },

    readDirectory({ kind, limit = 12, page = 1, at = Date.now(), today = null } = {}) {
      const instant = Number.isFinite(Number(at)) ? Number(at) : Date.now();
      const day = typeof today === "string" && isStrictCalendarDate(today)
        ? today : new Date(instant).toISOString().slice(0, 10);
      const pageSize = bounded(limit, 12, 12);
      const pageNumber = Number(page);
      if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > 1_000) return null;
      const offset = (pageNumber - 1) * pageSize;
      if (kind === "artists") {
        const rows = directoryArtists.all(instant, day, pageSize + 1, offset);
        return { kind, page: pageNumber, pageSize, total: Number(rows[0]?.directory_total) || 0,
          hasNext: rows.length > pageSize, artists: rows.slice(0, pageSize) };
      }
      if (kind === "events") {
        const rows = directoryEvents.all(instant, day, pageSize + 1, offset);
        return { kind, page: pageNumber, pageSize, total: Number(rows[0]?.directory_total) || 0,
          hasNext: rows.length > pageSize, events: rows.slice(0, pageSize) };
      }
      if (kind === "venues") {
        const rows = directoryVenues.all(instant, day, instant, day, pageSize + 1, offset);
        return { kind, page: pageNumber, pageSize, total: Number(rows[0]?.directory_total) || 0,
          hasNext: rows.length > pageSize, venues: rows.slice(0, pageSize) };
      }
      if (kind === "concerts") {
        const rows = directoryConcerts.all(day, instant, day, pageSize + 1, offset);
        return { kind, page: pageNumber, pageSize, total: Number(rows[0]?.directory_total) || 0,
          hasNext: rows.length > pageSize, concerts: rows.slice(0, pageSize) };
      }
      return null;
    },
  });
}
