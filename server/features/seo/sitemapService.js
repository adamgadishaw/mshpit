import { activeAccountSql } from "../../accountVisibility.js";
import { profileAllowsSearchIndexingSql } from "../../profileSearchIndexing.js";
import { postMediaProjectionByPost } from "../../mediaAssets.js";
import { publicPageSitemapEntries } from "../../publicPages.js";
import { artistPath, concertPath, eventPath, postPath, profilePath, slugify, venuePath } from "../../../src/domain/urls.mjs";
import { createArtistMemorialRepository } from "../artistMemorials/artistMemorialRepository.js";
import { createArtistMemorialService } from "../artistMemorials/artistMemorialService.js";
import { archiveShowKey } from "../artistArchive/artistArchiveKeys.js";

export const SITEMAP_MAX_URLS = 50_000;
export const SITEMAP_MAX_BYTES = 50 * 1024 * 1024;

export const SITEMAP_PATHS = Object.freeze([
  "/sitemaps/pages.xml",
  "/sitemaps/artists.xml",
  "/sitemaps/events.xml",
  "/sitemaps/venues.xml",
  "/sitemaps/concerts.xml",
  "/sitemaps/posts.xml",
  "/sitemaps/profiles.xml",
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

export function pageSitemapEntries() {
  return [
    { path: "/" },
    { path: "/discover" },
    { path: "/artists" },
    { path: "/events" },
    ...publicPageSitemapEntries().map(({ path }) => ({ path })),
  ];
}

function visiblePostCandidates(database, limit = -1) {
  const readLimit = Number.isSafeInteger(limit) && limit > 0 ? limit : -1;
  const rows = database.prepare(`SELECT p.id,p.user_id,p.artist,p.artist_key,p.venue,p.venue_key,p.city,p.date,
      p.kind,p.overall,p.review,p.photos_public,p.created_at,p.updated_at,u.name AS author_name,u.handle AS author_handle
    FROM posts p JOIN users u ON u.id=p.user_id
    WHERE p.removed=0 AND ${activeAccountSql("u")}
      AND (LENGTH(TRIM(COALESCE(p.review,'')))>=40
        OR EXISTS (SELECT 1 FROM post_media pm WHERE pm.post_id=p.id))
    ORDER BY p.created_at DESC,p.id DESC LIMIT ?`).all(readLimit);
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

export function postSitemapEntries(database) {
  return visiblePostCandidates(database).filter((row) => row.meaningfulText || row.readyMedia.length).map((row) => {
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

export function profileSitemapEntries(database) {
  const imageProjection = verifiedProfileImageProjection(database);
  const postEntries = visiblePostCandidates(database);
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

export function artistSitemapEntries(database, { now = Date.now() } = {}) {
  const requestedAt = Number(now);
  const at = Number.isSafeInteger(requestedAt) && requestedAt >= 0 ? requestedAt : Date.now();
  const today = new Date(at).toISOString().slice(0, 10);
  const artistRows = database.prepare(`SELECT norm,name,public_slug,bio,mbid,updated_at FROM artists
      WHERE public_slug IS NOT NULL AND trim(public_slug)<>''
      ORDER BY rank_score DESC,norm`).all();
  const artistByNorm = new Map(artistRows.map((row) => [String(row.norm || "").trim().toLowerCase(), row]));
  const artistByName = new Map(artistRows.map((row) => [String(row.name || "").trim().toLowerCase(), row]));

  const postUpdates = new Map();
  for (const row of visiblePostCandidates(database)) {
    if (!row.meaningfulText && !(row.photos_public && row.readyMedia.length)) continue;
    const byKey = artistByNorm.get(String(row.artist_key || "").trim().toLowerCase());
    const byName = artistByName.get(String(row.artist || "").trim().toLowerCase());
    const artistKey = (byKey || byName)?.norm;
    if (!artistKey) continue;
    postUpdates.set(artistKey, newest(postUpdates.get(artistKey), row.updated_at, row.created_at));
  }

  const tourUpdates = new Map(database.prepare(`SELECT a.norm AS artist_key,MAX(td.updated_at) lastmod
    FROM tour_dates td JOIN artists a ON LOWER(TRIM(a.name))=LOWER(TRIM(td.artist))
    LEFT JOIN users owner ON owner.id=td.owner_id
    WHERE trim(COALESCE(td.artist,''))<>''
      AND td.release_at<=? AND td.date>=?
      AND td.date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND (td.owner_id IS NULL OR ${activeAccountSql("owner")})
      AND (td.owner_id IS NOT NULL OR COALESCE(td.provider_active,1)=1)
    GROUP BY a.norm`).all(at, today)
    .map((row) => [row.artist_key, Number(row.lastmod || 0)]));

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

function visibleUpcomingEvents(database, { now = Date.now(), limit = -1 } = {}) {
  const requestedAt = Number(now);
  const at = Number.isSafeInteger(requestedAt) && requestedAt >= 0 ? requestedAt : Date.now();
  const today = new Date(at).toISOString().slice(0, 10);
  const readLimit = Number.isSafeInteger(limit) && limit > 0 ? limit : -1;
  return database.prepare(`SELECT td.id,td.artist,td.venue,td.source,td.venue_provider_id,
      td.date,td.updated_at
    FROM tour_dates td LEFT JOIN users owner ON owner.id=td.owner_id
    WHERE td.release_at<=? AND td.date>=?
      AND td.date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND TRIM(COALESCE(td.artist,''))<>'' AND TRIM(COALESCE(td.venue,''))<>''
      AND (td.owner_id IS NULL OR ${activeAccountSql("owner")})
      AND (td.owner_id IS NOT NULL OR COALESCE(td.provider_active,1)=1)
    ORDER BY td.date ASC,td.id ASC LIMIT ?`).all(at, today, readLimit);
}

export function eventSitemapEntries(database, options = {}) {
  return visibleUpcomingEvents(database, options).map((row) => ({
    path: eventPath(row.id),
    lastmod: row.updated_at,
  }));
}

export function concertSitemapEntries(database, { now = Date.now() } = {}) {
  const requestedAt = Number(now);
  const at = Number.isSafeInteger(requestedAt) && requestedAt >= 0 ? requestedAt : Date.now();
  const today = new Date(at).toISOString().slice(0, 10);
  const concerts = new Map();
  for (const row of visiblePostCandidates(database)) {
    if (row.kind === "status" || !/^\d{4}-\d{2}-\d{2}$/.test(String(row.date || "")) || row.date > today) continue;
    if (!row.artist || !row.venue || (!row.meaningfulText && !(row.photos_public && row.readyMedia.length))) continue;
    const key = archiveShowKey({
      artistIdentity: row.artist_key || row.artist,
      venueIdentity: row.venue_key || row.venue,
      date: row.date,
    });
    const current = concerts.get(key);
    concerts.set(key, {
      path: concertPath(key),
      lastmod: newest(current?.lastmod, row.updated_at, row.created_at),
    });
  }
  return [...concerts.values()];
}

function venueLocationIdentity(row) {
  const structuredLocality = row?.venue_city || row?.city || "";
  const fallbackLocality = String(row?.place || "").split(",")[0];
  return slugify(structuredLocality || fallbackLocality);
}

function venueRouteCandidates(database, { now = Date.now() } = {}) {
  const requestedAt = Number(now);
  const at = Number.isSafeInteger(requestedAt) && requestedAt >= 0 ? requestedAt : Date.now();
  const today = new Date(at).toISOString().slice(0, 10);
  const events = database.prepare(`SELECT td.id,td.venue,td.place,td.source,td.venue_provider_id,
      td.venue_city,td.venue_region,td.venue_country_code,td.venue_country,td.updated_at
    FROM tour_dates td LEFT JOIN users owner ON owner.id=td.owner_id
    WHERE td.release_at<=? AND TRIM(COALESCE(td.venue,''))<>''
      AND (td.owner_id IS NULL OR ${activeAccountSql("owner")})
      AND (td.owner_id IS NOT NULL OR COALESCE(td.provider_active,1)=1 OR td.date<?)
    ORDER BY td.updated_at DESC,td.id DESC LIMIT 10000`).all(at, today);
  const posts = database.prepare(`SELECT p.id,p.venue,p.city,p.updated_at,p.created_at
    FROM posts p JOIN users u ON u.id=p.user_id
    WHERE p.removed=0 AND TRIM(COALESCE(p.venue,''))<>'' AND ${activeAccountSql("u")}
    ORDER BY p.updated_at DESC,p.created_at DESC,p.id DESC LIMIT 10000`).all();
  return { events, posts };
}

export function venueSitemapEntries(database, options = {}) {
  const upcomingById = new Map(visibleUpcomingEvents(database, options).map((row) => [row.id, row]));
  const publicPostsById = new Map(visiblePostCandidates(database)
    .filter((row) => row.kind !== "status" && (row.meaningfulText || (row.photos_public && row.readyMedia.length)))
    .map((row) => [row.id, row]));
  const routeCandidates = venueRouteCandidates(database, options);
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
      });
    }
    const group = groups.get(venueSlug);
    const location = venueLocationIdentity(row);
    if (location) group.locations.add(location);
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
    if (!providers.length && group.unattributedLastmod && group.locations.size <= 1) {
      addEntry(venuePath(group.name), group.unattributedLastmod);
    }
  }
  return [...entries.values()];
}

const SITEMAP_DATASETS = Object.freeze([
  ["pages", "/sitemaps/pages.xml"],
  ["artists", "/sitemaps/artists.xml"],
  ["events", "/sitemaps/events.xml"],
  ["venues", "/sitemaps/venues.xml"],
  ["concerts", "/sitemaps/concerts.xml"],
  ["posts", "/sitemaps/posts.xml"],
  ["profiles", "/sitemaps/profiles.xml"],
]);

function sitemapEntriesFor(name, database, now) {
  if (name === "pages") return pageSitemapEntries();
  if (!database?.prepare) return null;
  if (name === "artists") return artistSitemapEntries(database, { now });
  if (name === "events") return eventSitemapEntries(database, { now });
  if (name === "venues") return venueSitemapEntries(database, { now });
  if (name === "concerts") return concertSitemapEntries(database, { now });
  if (name === "posts") return postSitemapEntries(database);
  if (name === "profiles") return profileSitemapEntries(database);
  return null;
}

function sitemapRowPartsFor(name, { database, env, now, maxUrls, maxBytes }) {
  const entries = sitemapEntriesFor(name, database, now);
  return entries == null
    ? null
    : urlsetRowParts(entries, publicOrigin(env), { maxUrls, maxBytes });
}

function shardPath(basePath, partIndex) {
  return partIndex === 0 ? basePath : basePath.replace(/\.xml$/, `-${partIndex + 1}.xml`);
}

const MAX_NEGATIVE_SITEMAP_SHARDS = 512;

function parsedSitemapPath(pathname) {
  const match = /^\/sitemaps\/(pages|artists|events|venues|concerts|posts|profiles)(?:-([1-9][0-9]{0,4}))?\.xml$/
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
  const options = { database, env, now: generatedAt, maxUrls, maxBytes };
  const rowsByPath = new Map();
  const paths = [];
  for (const [name, basePath] of SITEMAP_DATASETS) {
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
