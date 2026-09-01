import { activeAccountSql } from "../../accountVisibility.js";
import { profileAllowsSearchIndexingSql } from "../../profileSearchIndexing.js";
import { postMediaProjectionByPost } from "../../mediaAssets.js";
import { publicPageSitemapEntries } from "../../publicPages.js";
import { projectedTourDateTicketUrl } from "../../../src/domain/ticketLinks.mjs";
import {
  artistConcertsPath,
  artistPath,
  artistsPath,
  cityConcertsPath,
  cityVenuesPath,
  concertPath,
  concertsPath,
  eventPath,
  eventsPath,
  postPath,
  profilePath,
  slugify,
  venuePath,
  venuesPath,
} from "../../../src/domain/urls.mjs";
import { createArtistMemorialRepository } from "../artistMemorials/artistMemorialRepository.js";
import { createArtistMemorialService } from "../artistMemorials/artistMemorialService.js";
import { archiveIdentityPart, archiveShowKey } from "../artistArchive/artistArchiveKeys.js";
import {
  PUBLIC_ENTITY_THRESHOLDS,
  isStrictCalendarDate,
  hasStructuredShowLocationCollision,
  isStrictIsoDateTime,
  qualifiesCityConcertDirectory,
  qualifiesCityVenueDirectory,
  structuredCityIdentity,
} from "./publicEntityPolicy.js";
import { createPublicDocumentRepository } from "./publicDocumentRepository.js";
import { currentOrUpcomingTourDateRow, effectiveTourDateEndSql } from "../../tourDateLifecycle.js";
import { tourDateHasNoPublishedMemorialSql } from "../../artistMemorialTourDateVisibility.js";

export const SITEMAP_MAX_URLS = 50_000;
export const SITEMAP_MAX_BYTES = 50 * 1024 * 1024;
// The current reducer shares candidates in memory. Crossing this explicit
// safety ceiling fails the refresh without swapping a partial snapshot; it is
// not a truncation limit. Move to the documented spool reducer before growth
// reaches this boundary.
export const SITEMAP_MAX_SOURCE_ROWS = 100_000;

export const SITEMAP_PATHS = Object.freeze([
  "/sitemaps/pages.xml",
  "/sitemaps/artists.xml",
  "/sitemaps/events.xml",
  "/sitemaps/venues.xml",
  "/sitemaps/cities.xml",
  "/sitemaps/concerts.xml",
  "/sitemaps/posts.xml",
  "/sitemaps/profiles.xml",
]);

const CANDIDATE_READ_SIZE = 500;
const NON_PURCHASABLE_EVENT_STATUSES = new Set([
  "cancelled", "canceled", "offsale", "off-sale", "off_sale", "unavailable",
]);

const xmlEscape = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&apos;");

const publicOrigin = (env = process.env) => {
  try {
    const parsed = new URL(String(env?.PUBLIC_ORIGIN || "https://www.mshpit.com"));
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) throw new TypeError("Invalid origin");
    return parsed.origin;
  } catch {
    return "https://www.mshpit.com";
  }
};

function isoDay(value) {
  const time = Number(value);
  if (!Number.isFinite(time) || time <= 0) return null;
  const date = new Date(time);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function newest(...values) {
  const valid = values.map(Number).filter((value) => Number.isFinite(value) && value > 0);
  return valid.length ? Math.max(...valid) : null;
}

function publicHttpsUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    return parsed.protocol === "https:" && !parsed.username && !parsed.password ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function verifiedProfileImageProjection(database) {
  const emptyProjection = ",NULL AS verified_avatar_url,NULL AS verified_banner_url";
  let tables;
  try {
    tables = new Set(database.prepare(`SELECT name FROM sqlite_master
      WHERE type='table' AND name IN ('legacy_media_finalize_descriptors','media_objects')`)
      .all()
      .map((row) => String(row.name || "")));
  } catch {
    return emptyProjection;
  }
  if (!tables.has("legacy_media_finalize_descriptors") || !tables.has("media_objects")) {
    return emptyProjection;
  }

  const verifiedField = (field, purpose, alias) => `CASE WHEN EXISTS (
    SELECT 1 FROM legacy_media_finalize_descriptors descriptor
    JOIN media_objects object
      ON object.owner_id=descriptor.owner_id
      AND object.object_key=descriptor.output_object_key
    WHERE descriptor.owner_id=u.id
      AND descriptor.output_url=u.${field}
      AND descriptor.purpose='${purpose}'
      AND descriptor.status='finalized'
      AND object.storage_scope='public'
      AND object.status IN ('issued','associated')
  ) THEN u.${field} ELSE NULL END AS ${alias}`;

  return `,${verifiedField("avatar_uri", "avatar", "verified_avatar_url")},
    ${verifiedField("banner", "banner", "verified_banner_url")}`;
}

function isoInstant(value) {
  const time = Number(value);
  if (!Number.isFinite(time) || time <= 0) return null;
  const date = new Date(time);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function compactText(value, maximum) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length <= maximum ? text : `${text.slice(0, Math.max(1, maximum - 1)).trimEnd()}…`;
}

function renderUrlRow(entry, base) {
  if (!entry?.path || !entry.path.startsWith("/")) return null;
  const loc = `${base}${entry.path}`;
  const lastmod = isoDay(entry.lastmod);
  const images = (Array.isArray(entry.images) ? entry.images : []).flatMap((image) => (
    image?.loc
      ? [`    <image:image>\n      <image:loc>${xmlEscape(image.loc)}</image:loc>\n    </image:image>`]
      : []
  ));
  const videos = (Array.isArray(entry.videos) ? entry.videos : []).flatMap((video) => {
    if (!video?.thumbnailLoc || !video?.title || !video?.description || !video?.contentLoc) return [];
    return [[
      "    <video:video>",
      `      <video:thumbnail_loc>${xmlEscape(video.thumbnailLoc)}</video:thumbnail_loc>`,
      `      <video:title>${xmlEscape(video.title)}</video:title>`,
      `      <video:description>${xmlEscape(video.description)}</video:description>`,
      `      <video:content_loc>${xmlEscape(video.contentLoc)}</video:content_loc>`,
      video.duration ? `      <video:duration>${video.duration}</video:duration>` : null,
      video.publicationDate ? `      <video:publication_date>${xmlEscape(video.publicationDate)}</video:publication_date>` : null,
      video.uploader ? `      <video:uploader>${xmlEscape(video.uploader)}</video:uploader>` : null,
      "    </video:video>",
    ].filter(Boolean).join("\n")];
  });
  const xml = [
    "  <url>",
    `    <loc>${xmlEscape(loc)}</loc>`,
    lastmod ? `    <lastmod>${lastmod}</lastmod>` : null,
    ...images,
    ...videos,
    "  </url>",
  ].filter(Boolean).join("\n");
  return {
    loc,
    xml,
    bytes: Buffer.byteLength(xml, "utf8"),
    hasImages: images.length > 0,
    hasVideos: videos.length > 0,
  };
}

function renderUrlsetRows(rows) {
  const hasImages = rows.some((row) => row.hasImages);
  const hasVideos = rows.some((row) => row.hasVideos);
  const namespaces = [
    'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    hasImages ? 'xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"' : null,
    hasVideos ? 'xmlns:video="http://www.google.com/schemas/sitemap-video/1.1"' : null,
  ].filter(Boolean).join(" ");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset ${namespaces}>\n${rows.map((row) => row.xml).join("\n")}\n</urlset>\n`;
}

function normalizedSitemapLimits({ maxUrls = SITEMAP_MAX_URLS, maxBytes = SITEMAP_MAX_BYTES } = {}) {
  return {
    maxUrls: Math.max(1, Math.min(SITEMAP_MAX_URLS, Math.floor(Number(maxUrls) || SITEMAP_MAX_URLS))),
    maxBytes: Math.max(256, Math.min(SITEMAP_MAX_BYTES, Math.floor(Number(maxBytes) || SITEMAP_MAX_BYTES))),
  };
}

function urlsetEnvelopeByteLength(hasImages, hasVideos) {
  const namespaces = [
    'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    hasImages ? 'xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"' : null,
    hasVideos ? 'xmlns:video="http://www.google.com/schemas/sitemap-video/1.1"' : null,
  ].filter(Boolean).join(" ");
  const envelope = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset ${namespaces}>\n\n</urlset>\n`;
  return Buffer.byteLength(envelope, "utf8");
}

function urlsetRowParts(entries, base, limits = {}) {
  const { maxUrls, maxBytes } = normalizedSitemapLimits(limits);
  const seen = new Set();
  const rows = [];
  for (const entry of entries) {
    const row = renderUrlRow(entry, base);
    if (!row || seen.has(row.loc)) continue;
    seen.add(row.loc);
    rows.push(row);
  }

  const parts = [];
  let current = [];
  let currentRowBytes = 0;
  let currentHasImages = false;
  let currentHasVideos = false;
  for (const row of rows) {
    const nextHasImages = currentHasImages || row.hasImages;
    const nextHasVideos = currentHasVideos || row.hasVideos;
    const nextBytes = urlsetEnvelopeByteLength(nextHasImages, nextHasVideos)
      + currentRowBytes
      + row.bytes
      + current.length;
    const exceedsCurrent = current.length >= maxUrls || nextBytes > maxBytes;
    if (exceedsCurrent && current.length) {
      parts.push(current);
      current = [];
      currentRowBytes = 0;
      currentHasImages = false;
      currentHasVideos = false;
    }
    // A single, pathological URL must not make the entire sitemap invalid.
    const candidateHasImages = currentHasImages || row.hasImages;
    const candidateHasVideos = currentHasVideos || row.hasVideos;
    const candidateBytes = urlsetEnvelopeByteLength(candidateHasImages, candidateHasVideos)
      + currentRowBytes
      + row.bytes
      + current.length;
    if (candidateBytes > maxBytes) continue;
    current.push(row);
    currentRowBytes += row.bytes;
    currentHasImages = candidateHasImages;
    currentHasVideos = candidateHasVideos;
  }
  if (current.length || !parts.length) parts.push(current);
  return parts;
}

export function urlsetParts(entries, base, limits = {}) {
  return urlsetRowParts(entries, base, limits).map((rows) => renderUrlsetRows(rows));
}

export function sitemapIndexXml(env = process.env, paths = SITEMAP_PATHS) {
  const base = publicOrigin(env);
  const seen = new Set();
  const rows = [];
  for (const path of paths) {
    if (!/^\/sitemaps\/[a-z0-9-]+\.xml$/.test(String(path || "")) || seen.has(path)) continue;
    seen.add(path);
    const row = [
      "  <sitemap>",
      `    <loc>${xmlEscape(`${base}${path}`)}</loc>`,
      "  </sitemap>",
    ].join("\n");
    if (rows.length >= SITEMAP_MAX_URLS) break;
    const candidate = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...rows, row].join("\n")}\n</sitemapindex>\n`;
    if (Buffer.byteLength(candidate, "utf8") > SITEMAP_MAX_BYTES) break;
    rows.push(row);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join("\n")}\n</sitemapindex>\n`;
}

export function pageSitemapEntries({ includeDiscover = true } = {}) {
  return [
    { path: "/" },
    includeDiscover ? { path: "/discover" } : null,
    ...publicPageSitemapEntries().map(({ path }) => ({ path })),
  ].filter(Boolean);
}

function visiblePostCandidates(database, limit = -1, { maximumRows = SITEMAP_MAX_SOURCE_ROWS } = {}) {
  const readLimit = Number.isSafeInteger(limit) && limit > 0 ? limit : null;
  const rows = [];
  const statement = database.prepare(`SELECT p.id,p.user_id,p.artist,p.artist_key,p.venue,p.venue_key,p.city,p.date,
      p.kind,p.experience_type,p.online_title,p.youtube_url,p.youtube_video_id,p.overall,p.review,p.photos_public,
      p.created_at,p.updated_at,u.name AS author_name,u.handle AS author_handle
    FROM posts p JOIN users u ON u.id=p.user_id
    WHERE p.removed=0 AND ${activeAccountSql("u")}
      AND (LENGTH(TRIM(COALESCE(p.review,'')))>=40
        OR EXISTS (SELECT 1 FROM post_media pm WHERE pm.post_id=p.id))
      AND (? IS NULL OR p.created_at<? OR (p.created_at=? AND p.id<?))
    ORDER BY p.created_at DESC,p.id DESC LIMIT ?`);
  let cursorAt = null;
  let cursorId = null;
  while (readLimit == null || rows.length < readLimit) {
    const batchSize = Math.min(CANDIDATE_READ_SIZE, readLimit == null ? CANDIDATE_READ_SIZE : readLimit - rows.length);
    const batch = statement.all(cursorAt, cursorAt, cursorAt, cursorId, batchSize);
    if (!batch.length) break;
    if (rows.length + batch.length > maximumRows) throw new RangeError("SITEMAP_SOURCE_ROW_LIMIT");
    rows.push(...batch);
    if (batch.length < batchSize) break;
    const last = batch.at(-1);
    cursorAt = Number(last.created_at);
    cursorId = String(last.id);
  }
  const mediaCandidates = rows.map((row) => row.id);
  const mediaByPost = new Map();
  // postMediaProjectionByPost intentionally caps each read at 100 identities.
  // Match that contract so later candidates are not silently omitted.
  for (let offset = 0; offset < mediaCandidates.length; offset += 100) {
    for (const [postId, media] of postMediaProjectionByPost(database, mediaCandidates.slice(offset, offset + 100))) {
      mediaByPost.set(postId, media);
    }
  }
  return rows.map((row) => ({
    ...row,
    meaningfulText: String(row.review || "").replace(/\s+/g, " ").trim().length >= 40,
    readyMedia: mediaByPost.get(row.id) || [],
  }));
}

function visibleTourDateCandidates(database, {
  now = Date.now(),
  maximumRows = SITEMAP_MAX_SOURCE_ROWS,
} = {}) {
  const requestedAt = Number(now);
  const at = Number.isSafeInteger(requestedAt) && requestedAt >= 0 ? requestedAt : Date.now();
  const today = new Date(at).toISOString().slice(0, 10);
  const rows = [];
  const statement = database.prepare(`SELECT td.id,td.provider_event_id,td.artist,td.artist_key,td.venue,td.place,td.source,
      td.venue_provider_id,td.date,td.event_end_date,td.updated_at,td.owner_id,COALESCE(td.provider_active,1) AS provider_active,
      td.event_status,td.ticket_url,td.start_date_time,td.venue_address_line1,td.venue_address_line2,
      td.venue_city,td.venue_region,td.venue_country_code,td.venue_country,
      CASE WHEN ${tourDateHasNoPublishedMemorialSql("td")} THEN 0 ELSE 1 END AS memorialized
    FROM tour_dates td INDEXED BY idx_tourdates_sitemap_cursor
    LEFT JOIN users owner ON owner.id=td.owner_id
    WHERE td.release_at<=?
      AND COALESCE(td.music_qualified,1)=1
      AND td.date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND TRIM(COALESCE(td.artist,''))<>'' AND TRIM(COALESCE(td.venue,''))<>''
      AND (td.owner_id IS NULL OR ${activeAccountSql("owner")})
      AND (td.owner_id IS NOT NULL OR COALESCE(td.provider_active,1)=1 OR ${effectiveTourDateEndSql("td")}<?)
      AND (? IS NULL OR td.date>? OR (td.date=? AND td.id>?))
    ORDER BY td.date ASC,td.id ASC LIMIT ?`);
  let cursorDate = null;
  let cursorId = null;
  while (true) {
    const batch = statement.all(
      at,
      today,
      cursorDate,
      cursorDate,
      cursorDate,
      cursorId,
      CANDIDATE_READ_SIZE,
    );
    if (!batch.length) break;
    if (rows.length + batch.length > maximumRows) throw new RangeError("SITEMAP_SOURCE_ROW_LIMIT");
    rows.push(...batch);
    if (batch.length < CANDIDATE_READ_SIZE) break;
    const last = batch.at(-1);
    cursorDate = String(last.date);
    cursorId = String(last.id);
  }
  return rows.filter((row) => isStrictCalendarDate(row.date));
}

export function materializeSitemapCandidates(database, {
  now = Date.now(),
  maximumSourceRows = SITEMAP_MAX_SOURCE_ROWS,
} = {}) {
  if (!database?.prepare) throw new TypeError("Sitemap candidates require a database");
  const requestedAt = Number(now);
  const at = Number.isSafeInteger(requestedAt) && requestedAt >= 0 ? requestedAt : Date.now();
  const today = new Date(at).toISOString().slice(0, 10);
  const safeMaximum = Math.max(1, Math.min(
    SITEMAP_MAX_SOURCE_ROWS,
    Math.floor(Number(maximumSourceRows) || SITEMAP_MAX_SOURCE_ROWS),
  ));
  const posts = visiblePostCandidates(database, -1, { maximumRows: safeMaximum });
  const tourDates = visibleTourDateCandidates(database, {
    now: at,
    maximumRows: safeMaximum - posts.length,
  });
  const upcomingEvents = tourDates.filter((row) => currentOrUpcomingTourDateRow(row, today)
    && (row.owner_id != null || Number(row.provider_active) === 1)
    && Number(row.memorialized) !== 1);
  return Object.freeze({
    generatedAt: at,
    today,
    posts: Object.freeze(posts),
    tourDates: Object.freeze(tourDates),
    upcomingEvents: Object.freeze(upcomingEvents),
  });
}

export function postSitemapEntries(database, { candidates = null } = {}) {
  const posts = candidates?.posts || visiblePostCandidates(database);
  return posts.filter((row) => row.meaningfulText || row.readyMedia.length).map((row) => {
    const context = compactText([
      row.artist,
      row.venue ? `at ${row.venue}` : "",
      row.author_handle ? `shared by @${row.author_handle}` : "shared on Mshpit",
    ].filter(Boolean).join(" "), 180);
    const images = [];
    const videos = [];
    for (const asset of row.readyMedia.slice(0, 8)) {
      const url = publicHttpsUrl(asset.url);
      if (!url) continue;
      if (asset.kind === "image") {
        images.push({ loc: url });
        continue;
      }
      const poster = publicHttpsUrl(asset.posterUrl);
      const duration = Math.round(Number(asset.durationMs) / 1_000);
      const publicationDate = isoInstant(asset.createdAt || row.created_at);
      if (!poster || !Number.isFinite(duration) || duration < 1 || duration > 28_800 || !publicationDate) continue;
      videos.push({
        thumbnailLoc: poster,
        title: compactText(asset.altText || context || "Concert clip on Mshpit", 100),
        description: compactText(row.review || asset.altText || context || "A concert clip shared on Mshpit.", 2_048),
        contentLoc: url,
        duration,
        publicationDate,
        uploader: compactText(row.author_name || (row.author_handle ? `@${row.author_handle}` : "Mshpit member"), 100),
      });
    }
    return {
      path: postPath(row.id),
      lastmod: row.updated_at || row.created_at,
      userId: row.user_id,
      images,
      videos,
    };
  });
}

export function profileSitemapEntries(database, { candidates = null } = {}) {
  const imageProjection = verifiedProfileImageProjection(database);
  const postEntries = candidates?.posts || visiblePostCandidates(database);
  const latestPostByUser = new Map();
  for (const row of postEntries) {
    if (!row.meaningfulText && !(row.photos_public && row.readyMedia.length)) continue;
    latestPostByUser.set(row.user_id, newest(latestPostByUser.get(row.user_id), row.updated_at, row.created_at));
  }
  return database.prepare(`SELECT u.id,u.handle,u.bio,u.created_at,u.profile_updated_at${imageProjection}
      FROM users u WHERE ${activeAccountSql("u")} AND ${profileAllowsSearchIndexingSql("u")} AND (
        LENGTH(TRIM(COALESCE(u.bio,'')))>=60 OR EXISTS (
          SELECT 1 FROM posts eligible
          WHERE eligible.user_id=u.id AND eligible.removed=0 AND (
            LENGTH(TRIM(COALESCE(eligible.review,'')))>=40 OR (
              eligible.photos_public=1 AND EXISTS (
                SELECT 1 FROM post_media eligible_media WHERE eligible_media.post_id=eligible.id
              )
            )
          )
        )
      )
      ORDER BY u.created_at DESC,u.id DESC`).all()
    .filter((row) => String(row.bio || "").replace(/\s+/g, " ").trim().length >= 60 || latestPostByUser.has(row.id))
    .map((row) => ({
      path: profilePath(row.handle),
      lastmod: newest(row.created_at, row.profile_updated_at, latestPostByUser.get(row.id)),
      images: [...new Set([row.verified_banner_url, row.verified_avatar_url]
        .map(publicHttpsUrl)
        .filter(Boolean))]
        .map((loc) => ({ loc })),
    }));
}

export function artistSitemapEntries(database, { now = Date.now(), candidates = null } = {}) {
  const requestedAt = Number(now);
  const at = Number.isSafeInteger(requestedAt) && requestedAt >= 0 ? requestedAt : Date.now();
  const today = new Date(at).toISOString().slice(0, 10);
  const artistRows = database.prepare(`SELECT norm,name,public_slug,bio,mbid,updated_at FROM artists
      WHERE public_slug IS NOT NULL AND trim(public_slug)<>''
      ORDER BY rank_score DESC,norm`).all();
  const artistByNorm = new Map(artistRows.map((row) => [String(row.norm || "").trim().toLowerCase(), row]));
  const artistByName = new Map();
  const ambiguousArtistNames = new Set();
  for (const row of artistRows) {
    const name = String(row.name || "").trim().toLowerCase();
    if (!name || ambiguousArtistNames.has(name)) continue;
    if (artistByName.has(name)) {
      artistByName.delete(name);
      ambiguousArtistNames.add(name);
    } else {
      artistByName.set(name, row);
    }
  }

  const postUpdates = new Map();
  for (const row of candidates?.posts || visiblePostCandidates(database)) {
    if (!row.meaningfulText && !(row.photos_public && row.readyMedia.length)) continue;
    const byKey = artistByNorm.get(String(row.artist_key || "").trim().toLowerCase());
    const byName = artistByName.get(String(row.artist || "").trim().toLowerCase());
    const artistKey = (byKey || byName)?.norm;
    if (!artistKey) continue;
    postUpdates.set(artistKey, newest(postUpdates.get(artistKey), row.updated_at, row.created_at));
  }

  const tourUpdates = new Map();
  const upcomingEvents = candidates?.upcomingEvents || visibleTourDateCandidates(database, { now: at })
    .filter((row) => currentOrUpcomingTourDateRow(row, today) && (row.owner_id != null || Number(row.provider_active) === 1));
  for (const row of upcomingEvents) {
    const byKey = artistByNorm.get(String(row.artist_key || "").trim().toLowerCase());
    const byName = artistByName.get(String(row.artist || "").trim().toLowerCase());
    const artistKey = (byKey || byName)?.norm;
    if (artistKey) tourUpdates.set(artistKey, newest(tourUpdates.get(artistKey), row.updated_at));
  }

  const profileDetails = new Map(database.prepare(`SELECT ap.artist_key,ap.bio,ap.updated_at
    FROM artist_profiles ap JOIN users owner ON owner.id=ap.owner_id
    WHERE ap.removed=0 AND ${activeAccountSql("owner")}`).all()
    .map((row) => [row.artist_key, row]));
  const officialUpdates = new Map(database.prepare(`SELECT post.artist_key,MAX(post.created_at) AS lastmod
    FROM artist_posts post
    JOIN artist_profiles ap ON ap.artist_key=post.artist_key AND ap.removed=0 AND ap.feed_enabled=1
    JOIN users owner ON owner.id=ap.owner_id
    JOIN users author ON author.id=post.user_id
    WHERE post.removed=0 AND ${activeAccountSql("owner")} AND ${activeAccountSql("author")}
    GROUP BY post.artist_key`).all()
    .map((row) => [row.artist_key, Number(row.lastmod || 0)]));

  const memorials = createArtistMemorialService({ repository: createArtistMemorialRepository(database) });
  const memorialDetails = new Map();
  // The public memorial service caps identity-bound batches at 40. Chunking
  // preserves that boundary and avoids reimplementing publication/identity
  // policy as a second sitemap-only SQL query.
  for (let offset = 0; offset < artistRows.length; offset += 40) {
    const batch = artistRows.slice(offset, offset + 40);
    const matches = memorials.readPublicForArtistKeysWithMetadata({
      artistKeys: batch.map((row) => row.norm),
      artistMbids: new Map(batch.map((row) => [row.norm, row.mbid])),
      at,
    });
    for (const [artistKey, detail] of matches) memorialDetails.set(artistKey, detail);
  }

  return artistRows.filter((row) => memorialDetails.has(row.norm)
      || String(profileDetails.get(row.norm)?.bio || row.bio || "").replace(/\s+/g, " ").trim().length >= 80
      || postUpdates.has(row.norm)
      || tourUpdates.has(row.norm))
    .map((row) => ({
      path: artistPath({ name: row.name, publicSlug: row.public_slug }),
      artistKey: row.norm,
      artistName: row.name,
      publicSlug: row.public_slug,
      lastmod: newest(
        row.updated_at,
        profileDetails.get(row.norm)?.updated_at,
        officialUpdates.get(row.norm),
        postUpdates.get(row.norm),
        tourUpdates.get(row.norm),
        memorialDetails.get(row.norm)?.updatedAt,
      ),
    }));
}

function visibleUpcomingEvents(database, { now = Date.now(), limit = -1, candidates = null } = {}) {
  const requestedAt = Number(now);
  const at = Number.isSafeInteger(requestedAt) && requestedAt >= 0 ? requestedAt : Date.now();
  const today = new Date(at).toISOString().slice(0, 10);
  const rows = (candidates?.upcomingEvents || visibleTourDateCandidates(database, { now: at }))
    .filter((row) => currentOrUpcomingTourDateRow(row, today)
      && (row.owner_id != null || Number(row.provider_active) === 1)
      && Number(row.memorialized) !== 1);
  return Number.isSafeInteger(limit) && limit > 0 ? rows.slice(0, limit) : rows;
}

export function hasIndexableEventEvidence({
  eligibleFanContent = false,
  currentPublicTicketUrl = null,
  completeRichEvent = false,
} = {}) {
  return Boolean(
    eligibleFanContent
    || publicHttpsUrl(currentPublicTicketUrl)
    || completeRichEvent,
  );
}

function eventEvidenceKey(row) {
  const artist = String(row?.artist || "").toLowerCase();
  const venue = String(row?.venue || "").toLowerCase();
  const date = String(row?.date || "");
  return artist && venue && isStrictCalendarDate(date)
    ? JSON.stringify([artist, venue, date])
    : null;
}

function eligibleFanEvidenceByEvent(posts) {
  const evidence = new Map();
  for (const row of posts || []) {
    if (row.kind != null && row.kind !== "review") continue;
    if ((row.experience_type || "in_person") !== "in_person") continue;
    if (!row.meaningfulText && !(row.photos_public && row.readyMedia?.length)) continue;
    const key = eventEvidenceKey(row);
    if (key) evidence.set(key, newest(evidence.get(key), row.updated_at, row.created_at));
  }
  return evidence;
}

function currentPublicEventTicketUrl(row, today) {
  const status = String(row?.event_status || "").trim().toLowerCase();
  if (!isStrictCalendarDate(row?.date) || row.date < today || NON_PURCHASABLE_EVENT_STATUSES.has(status)) {
    return null;
  }
  return projectedTourDateTicketUrl(row) || null;
}

function hasCompleteRichEventRow(row) {
  return isStrictIsoDateTime(row?.start_date_time)
    && Boolean(String(row?.venue_address_line1 || row?.venue_address_line2 || "").trim())
    && Boolean(String(row?.venue_city || "").trim())
    && Boolean(String(row?.venue_country_code || row?.venue_country || "").trim());
}

export function eventSitemapEntries(database, options = {}) {
  const candidates = options.candidates || null;
  const events = visibleUpcomingEvents(database, options);
  const fanEvidence = eligibleFanEvidenceByEvent(candidates?.posts || visiblePostCandidates(database));
  const today = candidates?.today
    || new Date(Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now()).toISOString().slice(0, 10);
  return events.flatMap((row) => {
    const fanLastmod = fanEvidence.get(eventEvidenceKey(row));
    if (!hasIndexableEventEvidence({
      eligibleFanContent: Boolean(fanLastmod),
      currentPublicTicketUrl: currentPublicEventTicketUrl(row, today),
      completeRichEvent: hasCompleteRichEventRow(row),
    })) return [];
    return [{
      path: eventPath(row.id),
      lastmod: newest(row.updated_at, fanLastmod),
    }];
  });
}

function publicConcertCandidates(database, { now = Date.now(), candidates = null } = {}) {
  const requestedAt = Number(now);
  const at = Number.isSafeInteger(requestedAt) && requestedAt >= 0 ? requestedAt : Date.now();
  const today = new Date(at).toISOString().slice(0, 10);
  const concerts = new Map();
  const posts = candidates?.posts || visiblePostCandidates(database);
  const locationRowsByShow = new Map();
  for (const tourRow of candidates?.tourDates || visibleTourDateCandidates(database, { now: at })) {
    const showKey = showLocationKey(tourRow);
    if (!showKey) continue;
    if (!locationRowsByShow.has(showKey)) locationRowsByShow.set(showKey, []);
    locationRowsByShow.get(showKey).push(tourRow);
  }
  for (const row of posts) {
    if (row.kind === "status" || (row.experience_type || "in_person") !== "in_person"
      || !isStrictCalendarDate(row.date) || row.date > today) continue;
    if (!row.artist || !row.venue || (!row.meaningfulText && !(row.photos_public && row.readyMedia.length))) continue;
    if (hasStructuredShowLocationCollision(locationRowsByShow.get(showLocationKey(row)))) continue;
    const key = archiveShowKey({
      artistIdentity: row.artist_key || row.artist,
      venueIdentity: row.venue_key || row.venue,
      date: row.date,
    });
    const current = concerts.get(key);
    concerts.set(key, {
      path: concertPath(key),
      lastmod: newest(current?.lastmod, row.updated_at, row.created_at),
      artistKey: row.artist_key || null,
      artistName: row.artist,
      venueKey: row.venue_key || null,
      venueName: row.venue,
      date: row.date,
    });
  }
  return [...concerts.values()];
}

export function concertSitemapEntries(database, options = {}) {
  return publicConcertCandidates(database, options).map(({ path, lastmod }) => ({ path, lastmod }));
}

function venueLocationIdentity(row) {
  return slugify(row?.venue_city || row?.city || row?.place || "");
}

export function venueSitemapEntries(database, options = {}) {
  const upcomingById = new Map(visibleUpcomingEvents(database, options).map((row) => [row.id, row]));
  const publicPostRows = options.candidates?.posts || visiblePostCandidates(database);
  const publicPostsById = new Map(publicPostRows
    .filter((row) => row.kind !== "status" && (row.experience_type || "in_person") === "in_person"
      && (row.meaningfulText || (row.photos_public && row.readyMedia.length)))
    .map((row) => [row.id, row]));
  const routeCandidates = {
    events: options.candidates?.tourDates || visibleTourDateCandidates(database, options),
    posts: publicPostRows,
  };
  const groups = new Map();
  const groupFor = (row) => {
    const venueSlug = slugify(row?.venue);
    if (!venueSlug) return null;
    if (!groups.has(venueSlug)) {
      groups.set(venueSlug, {
        name: row.venue,
        locations: new Set(),
        providers: new Map(),
        unattributedLastmod: null,
        hasUnstructuredLocation: false,
      });
    }
    const group = groups.get(venueSlug);
    const location = venueLocationIdentity(row);
    if (location) group.locations.add(location);
    else group.hasUnstructuredLocation = true;
    return group;
  };

  for (const row of routeCandidates.events) {
    const group = groupFor(row);
    if (!group) continue;
    const providerPath = row.venue_provider_id ? venuePath({
      name: row.venue,
      providerVenueId: row.venue_provider_id,
      source: row.source,
    }) : null;
    const upcoming = upcomingById.get(row.id);
    if (!providerPath) {
      if (upcoming) group.unattributedLastmod = newest(group.unattributedLastmod, upcoming.updated_at);
      continue;
    }
    const provider = group.providers.get(providerPath) || { path: providerPath, eligibleLastmod: null };
    if (upcoming) provider.eligibleLastmod = newest(provider.eligibleLastmod, upcoming.updated_at);
    group.providers.set(providerPath, provider);
  }

  for (const row of routeCandidates.posts) {
    const group = groupFor(row);
    const post = publicPostsById.get(row.id);
    if (!group || !post) continue;
    group.unattributedLastmod = newest(group.unattributedLastmod, post.updated_at, post.created_at);
  }

  const entries = new Map();
  const addEntry = (path, lastmod) => {
    if (!path || !lastmod) return;
    entries.set(path, { path, lastmod: newest(entries.get(path)?.lastmod, lastmod) });
  };
  for (const group of groups.values()) {
    const providers = [...group.providers.values()];
    for (const provider of providers) addEntry(provider.path, provider.eligibleLastmod);
    // A name-only post is not proof that it belongs to a provider venue. Never
    // let that post change or populate the provider-specific sitemap leaf.
    // A name-only URL is safe only when no provider identity can redirect it
    // and the available locality evidence does not collapse distinct rooms.
    if (!providers.length && group.unattributedLastmod && !group.hasUnstructuredLocation && group.locations.size === 1) {
      addEntry(venuePath(group.name), group.unattributedLastmod);
    }
  }
  return [...entries.values()];
}

export function paginationEntries({ itemCount, lastmod, pathFor, includeFirst = false }) {
  const pages = Math.min(
    1_000,
    Math.ceil(Math.max(0, Number(itemCount) || 0) / PUBLIC_ENTITY_THRESHOLDS.collectionPageSize),
  );
  const first = includeFirst ? 1 : 2;
  const entries = [];
  for (let page = first; page <= pages; page += 1) {
    const path = pathFor(page);
    if (path) entries.push({ path, lastmod });
  }
  return entries;
}

function collectionPageSitemapEntries({ artists, events, venues, concerts, totals }) {
  return [
    ...paginationEntries({
      itemCount: totals.artists,
      lastmod: newest(...artists.map((row) => row.lastmod)),
      pathFor: artistsPath,
      includeFirst: true,
    }),
    ...paginationEntries({
      itemCount: totals.events,
      lastmod: newest(...events.map((row) => row.updated_at)),
      pathFor: eventsPath,
      includeFirst: true,
    }),
    ...paginationEntries({
      itemCount: totals.venues,
      lastmod: newest(...venues.map((row) => row.lastmod)),
      pathFor: venuesPath,
      includeFirst: true,
    }),
    ...paginationEntries({
      itemCount: totals.concerts,
      lastmod: newest(...concerts.map((row) => row.lastmod)),
      pathFor: concertsPath,
      includeFirst: true,
    }),
  ];
}

const displayIdentity = (value) => String(value || "").trim().toLocaleLowerCase("en");

function showLocationKey(row) {
  const artist = displayIdentity(row?.artistName || row?.artist);
  const venue = displayIdentity(row?.venueName || row?.venue);
  const date = String(row?.date || "");
  return artist && venue && isStrictCalendarDate(date)
    ? JSON.stringify([artist, venue, date])
    : null;
}

const structuredLocationComparisonKey = (identity) => identity
  ? JSON.stringify([identity.countryCode.toUpperCase(), displayIdentity(identity.city)])
  : null;
const structuredLocationRouteKey = (identity) => identity
  ? [identity.countryCode.toLowerCase(), slugify(identity.city)].join("|")
  : null;
const isActivePublicTourRow = (row) => row?.owner_id != null || Number(row?.provider_active) === 1;

function compareRepresentativeEvents(left, right) {
  const leftProviderRank = String(left?.provider_event_id || "").trim() ? 0 : 1;
  const rightProviderRank = String(right?.provider_event_id || "").trim() ? 0 : 1;
  if (leftProviderRank !== rightProviderRank) return leftProviderRank - rightProviderRank;
  for (const field of ["source", "provider_event_id", "id"]) {
    const compared = displayIdentity(left?.[field]).localeCompare(displayIdentity(right?.[field]));
    if (compared) return compared;
  }
  return 0;
}

function citySitemapEntries({ candidates, venueEntries, concerts }) {
  const indexableVenues = new Set(venueEntries.map((row) => row.path));
  const tourRowsByShow = new Map();
  const venueNameEvidence = new Map();
  const cityNamesByRoute = new Map();

  for (const row of candidates.tourDates) {
    if (!isActivePublicTourRow(row)) continue;
    const identity = structuredCityIdentity(row);
    const locationKey = structuredLocationComparisonKey(identity);
    const routeKey = structuredLocationRouteKey(identity);
    if (routeKey) {
      if (!cityNamesByRoute.has(routeKey)) cityNamesByRoute.set(routeKey, new Set());
      cityNamesByRoute.get(routeKey).add(displayIdentity(identity.city));
    }

    const venueName = displayIdentity(row.venue);
    if (venueName) {
      if (!venueNameEvidence.has(venueName)) {
        venueNameEvidence.set(venueName, {
          hasProvider: false,
          hasUnstructured: false,
          locations: new Set(),
        });
      }
      const evidence = venueNameEvidence.get(venueName);
      if (String(row.venue_provider_id || "").trim()) evidence.hasProvider = true;
      if (locationKey) evidence.locations.add(locationKey);
      else evidence.hasUnstructured = true;
    }

    const showKey = showLocationKey(row);
    if (!showKey || !identity) continue;
    if (!tourRowsByShow.has(showKey)) tourRowsByShow.set(showKey, []);
    tourRowsByShow.get(showKey).push({ row, identity, locationKey });
  }

  const showDetails = new Map();
  for (const [showKey, rows] of tourRowsByShow) {
    const locations = new Set(rows.map((entry) => entry.locationKey));
    const artistKeys = new Set(rows
      .map((entry) => displayIdentity(entry.row.artist_key))
      .filter(Boolean));
    const representative = [...rows].sort((left, right) =>
      compareRepresentativeEvents(left.row, right.row))[0];
    showDetails.set(showKey, { representative, locations, artistKeys });
  }

  const groupFor = (map, identity) => {
    const routeKey = structuredLocationRouteKey(identity);
    if (!routeKey) return null;
    if (!map.has(routeKey)) map.set(routeKey, {
      identity,
      routeKey,
      itemIds: new Set(),
      venuePaths: new Set(),
      lastmod: null,
    });
    return map.get(routeKey);
  };

  const venueGroups = new Map();
  for (const [showKey, detail] of showDetails) {
    if (detail.locations.size !== 1) continue;
    const { row, identity, locationKey } = detail.representative;
    if (row.date < candidates.today) continue;
    const providerVenueId = String(row.venue_provider_id || "").trim();
    const evidence = venueNameEvidence.get(displayIdentity(row.venue));
    const safeNameOnly = !providerVenueId && evidence
      && !evidence.hasProvider
      && !evidence.hasUnstructured
      && evidence.locations.size === 1
      && evidence.locations.has(locationKey);
    const path = providerVenueId
      ? venuePath({ name: row.venue, providerVenueId, source: row.source })
      : safeNameOnly ? venuePath(row.venue) : null;
    if (!path || !indexableVenues.has(path)) continue;
    const group = groupFor(venueGroups, identity);
    if (!group) continue;
    group.itemIds.add(showKey);
    group.venuePaths.add(path);
    group.lastmod = newest(group.lastmod, row.updated_at);
  }

  const concertGroups = new Map();
  for (const row of concerts) {
    const detail = showDetails.get(showLocationKey(row));
    const artistKey = displayIdentity(row.artistKey);
    if (!detail || detail.locations.size !== 1 || !artistKey
      || detail.artistKeys.size !== 1 || !detail.artistKeys.has(artistKey)) continue;
    const identity = detail.representative.identity;
    const venueIdentity = archiveIdentityPart(row.venueKey || row.venueName);
    if (!venueIdentity) continue;
    const group = groupFor(concertGroups, identity);
    if (!group) continue;
    group.itemIds.add(row.path);
    group.venuePaths.add(venueIdentity);
    group.lastmod = newest(group.lastmod, row.lastmod);
  }

  const entries = [];
  for (const group of venueGroups.values()) {
    if (cityNamesByRoute.get(group.routeKey)?.size !== 1 || !qualifiesCityVenueDirectory({
      itemCount: group.itemIds.size,
      venueCount: group.venuePaths.size,
    })) continue;
    entries.push(...paginationEntries({
      itemCount: group.venuePaths.size,
      lastmod: group.lastmod,
      includeFirst: true,
      pathFor: (page) => cityVenuesPath(group.identity, page),
    }));
  }
  for (const group of concertGroups.values()) {
    if (cityNamesByRoute.get(group.routeKey)?.size !== 1 || !qualifiesCityConcertDirectory({
      itemCount: group.itemIds.size,
      venueCount: group.venuePaths.size,
    })) continue;
    entries.push(...paginationEntries({
      itemCount: group.itemIds.size,
      lastmod: group.lastmod,
      includeFirst: true,
      pathFor: (page) => cityConcertsPath(group.identity, page),
    }));
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}
function artistArchiveSitemapEntries({ artistEntries, concerts }) {
  const byKey = new Map(artistEntries.map((row) => [String(row.artistKey || "").toLowerCase(), row]));
  const byName = new Map();
  const ambiguousNames = new Set();
  for (const row of artistEntries) {
    const name = String(row.artistName || "").trim().toLowerCase();
    if (!name || ambiguousNames.has(name)) continue;
    if (byName.has(name)) {
      byName.delete(name);
      ambiguousNames.add(name);
    } else {
      byName.set(name, row);
    }
  }
  const groups = new Map();
  for (const concert of concerts) {
    const artist = byKey.get(String(concert.artistKey || "").toLowerCase())
      || byName.get(String(concert.artistName || "").trim().toLowerCase());
    if (!artist?.publicSlug) continue;
    if (!groups.has(artist.publicSlug)) groups.set(artist.publicSlug, { items: [], lastmod: null });
    const group = groups.get(artist.publicSlug);
    group.items.push(concert);
    group.lastmod = newest(group.lastmod, concert.lastmod);
  }
  const entries = [];
  for (const [publicSlug, group] of groups) {
    entries.push(...paginationEntries({
      itemCount: group.items.length,
      lastmod: group.lastmod,
      includeFirst: true,
      pathFor: (page) => artistConcertsPath(publicSlug, page),
    }));
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

const SITEMAP_DATASETS = Object.freeze([
  ["pages", "/sitemaps/pages.xml"],
  ["artists", "/sitemaps/artists.xml"],
  ["events", "/sitemaps/events.xml"],
  ["venues", "/sitemaps/venues.xml"],
  ["cities", "/sitemaps/cities.xml"],
  ["concerts", "/sitemaps/concerts.xml"],
  ["posts", "/sitemaps/posts.xml"],
  ["profiles", "/sitemaps/profiles.xml"],
]);

export function buildSitemapDatasets(database, { now = Date.now() } = {}) {
  if (!database?.prepare) return new Map([["pages", pageSitemapEntries()]]);
  const candidates = materializeSitemapCandidates(database, { now });
  const options = { now: candidates.generatedAt, candidates };
  const artists = artistSitemapEntries(database, options);
  const events = eventSitemapEntries(database, options);
  const venues = venueSitemapEntries(database, options);
  // Collection pages and leaf sitemaps deliberately have different quality
  // policies. Count the actual public directory query once during the async
  // snapshot build so a broader leaf candidate set can never manufacture an
  // empty /page/N URL.
  const directoryRepository = createPublicDocumentRepository(database);
  const directoryTotals = Object.fromEntries(
    ["artists", "events", "venues", "concerts"].map((kind) => [kind,
      directoryRepository.readDirectory({ kind, page: 1, at: candidates.generatedAt, today: candidates.today })?.total || 0]),
  );
  const concerts = publicConcertCandidates(database, options);
  const pages = [
    ...pageSitemapEntries({
      includeDiscover: artists.length > 0
        || candidates.upcomingEvents.length > 0
        || candidates.posts.some((row) => row.meaningfulText || row.readyMedia.length),
    }),
    ...collectionPageSitemapEntries({
      artists,
      events: candidates.upcomingEvents,
      venues,
      concerts,
      totals: directoryTotals,
    }),
  ];
  const cities = citySitemapEntries({ candidates, venueEntries: venues, concerts });
  const artistArchives = artistArchiveSitemapEntries({ artistEntries: artists, concerts });
  const datasets = new Map([
    ["pages", pages],
    ["artists", artists],
    ["events", events],
    ["venues", venues],
    ["cities", cities],
    ["concerts", [
      ...concerts.map(({ path, lastmod }) => ({ path, lastmod })),
      ...artistArchives,
    ]],
    ["posts", postSitemapEntries(database, options)],
    ["profiles", profileSitemapEntries(database, options)],
  ]);
  Object.defineProperty(datasets, "sourceCounts", {
    value: Object.freeze({
      posts: candidates.posts.length,
      tourDates: candidates.tourDates.length,
      upcomingEvents: candidates.upcomingEvents.length,
    }),
    enumerable: false,
  });
  return datasets;
}

function sitemapRowPartsFor(name, { database, env, now, maxUrls, maxBytes, datasets = null }) {
  const entries = (datasets || buildSitemapDatasets(database, { now })).get(name);
  return entries == null
    ? null
    : urlsetRowParts(entries, publicOrigin(env), { maxUrls, maxBytes });
}

function shardPath(basePath, partIndex) {
  return partIndex === 0 ? basePath : basePath.replace(/\.xml$/, `-${partIndex + 1}.xml`);
}

const MAX_NEGATIVE_SITEMAP_SHARDS = 512;

function parsedSitemapPath(pathname) {
  const match = /^\/sitemaps\/(pages|artists|events|venues|cities|concerts|posts|profiles)(?:-([1-9][0-9]{0,4}))?\.xml$/
    .exec(String(pathname || ""));
  if (!match) return null;
  const shardNumber = match[2] ? Number(match[2]) : 1;
  if (shardNumber < 1 || shardNumber > SITEMAP_MAX_URLS || (match[2] && shardNumber < 2)) return null;
  return { name: match[1], partIndex: shardNumber - 1 };
}

export function isSitemapRequestPath(pathname) {
  return pathname === "/sitemap.xml" || Boolean(parsedSitemapPath(pathname));
}

export function createSitemapSnapshot({
  database,
  env = process.env,
  now = Date.now(),
  maxUrls = SITEMAP_MAX_URLS,
  maxBytes = SITEMAP_MAX_BYTES,
} = {}) {
  const requestedAt = Number(now);
  const generatedAt = Number.isSafeInteger(requestedAt) && requestedAt >= 0
    ? requestedAt
    : Date.now();
  const datasets = buildSitemapDatasets(database, { now: generatedAt });
  const options = { database, env, now: generatedAt, maxUrls, maxBytes, datasets };
  const rowsByPath = new Map();
  const paths = [];
  const datasetCounts = {};
  for (const [name, basePath] of SITEMAP_DATASETS) {
    datasetCounts[name] = datasets.get(name)?.length || 0;
    const rowParts = sitemapRowPartsFor(name, options);
    if (!rowParts) continue;
    for (let index = 0; index < rowParts.length; index += 1) {
      const path = shardPath(basePath, index);
      paths.push(path);
      rowsByPath.set(path, rowParts[index]);
    }
  }

  const responseCache = new Map([
    ["/sitemap.xml", sitemapIndexXml(env, paths)],
  ]);
  const missingCache = new Set();
  const rememberMissing = (path) => {
    if (missingCache.has(path)) return;
    if (missingCache.size >= MAX_NEGATIVE_SITEMAP_SHARDS) {
      missingCache.delete(missingCache.values().next().value);
    }
    missingCache.add(path);
  };

  return Object.freeze({
    generatedAt,
    paths: Object.freeze([...paths]),
    stats: Object.freeze({
      totalUrls: Object.values(datasetCounts).reduce((total, count) => total + count, 0),
      datasetCounts: Object.freeze({ ...datasetCounts }),
      sourceCounts: Object.freeze({ ...(datasets.sourceCounts || {}) }),
      shardCount: paths.length,
    }),
    xmlFor(pathname) {
      const path = String(pathname || "");
      if (responseCache.has(path)) return responseCache.get(path);
      if (!parsedSitemapPath(path)) return null;
      if (missingCache.has(path)) return null;
      const rows = rowsByPath.get(path);
      if (!rows) {
        rememberMissing(path);
        return null;
      }
      const body = renderUrlsetRows(rows);
      responseCache.set(path, body);
      return body;
    },
  });
}

export function sitemapXmlFor(pathname, {
  database,
  env = process.env,
  now = Date.now(),
  maxUrls = SITEMAP_MAX_URLS,
  maxBytes = SITEMAP_MAX_BYTES,
} = {}) {
  const options = { database, env, now, maxUrls, maxBytes };
  if (pathname === "/sitemap.xml") {
    if (!database?.prepare) return sitemapIndexXml(env);
    return createSitemapSnapshot(options).xmlFor(pathname);
  }
  const parsed = parsedSitemapPath(pathname);
  if (!parsed) return null;
  const rowParts = sitemapRowPartsFor(parsed.name, options);
  const rows = rowParts?.[parsed.partIndex];
  return rows ? renderUrlsetRows(rows) : null;
}
