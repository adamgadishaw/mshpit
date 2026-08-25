import { activeAccountSql } from "../../accountVisibility.js";
import { postMediaProjectionByPost } from "../../mediaAssets.js";
import { publicPageSitemapEntries } from "../../publicPages.js";
import { artistPath, postPath, profilePath } from "../../../src/domain/urls.mjs";
import { createArtistMemorialRepository } from "../artistMemorials/artistMemorialRepository.js";
import { createArtistMemorialService } from "../artistMemorials/artistMemorialService.js";

export const SITEMAP_PATHS = Object.freeze([
  "/sitemaps/pages.xml",
  "/sitemaps/artists.xml",
  "/sitemaps/posts.xml",
  "/sitemaps/profiles.xml",
]);

const xmlEscape = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&apos;");

const publicOrigin = (env = process.env) =>
  String(env?.PUBLIC_ORIGIN || "https://www.mshpit.com").replace(/\/+$/, "");

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

function urlset(entries, base) {
  const seen = new Set();
  const rows = [];
  for (const entry of entries) {
    if (!entry?.path || !entry.path.startsWith("/")) continue;
    const loc = `${base}${entry.path}`;
    if (seen.has(loc)) continue;
    seen.add(loc);
    const lastmod = isoDay(entry.lastmod);
    rows.push([
      "  <url>",
      `    <loc>${xmlEscape(loc)}</loc>`,
      lastmod ? `    <lastmod>${lastmod}</lastmod>` : null,
      "  </url>",
    ].filter(Boolean).join("\n"));
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join("\n")}\n</urlset>\n`;
}

export function sitemapIndexXml(env = process.env) {
  const base = publicOrigin(env);
  const rows = SITEMAP_PATHS.map((path) => [
    "  <sitemap>",
    `    <loc>${xmlEscape(`${base}${path}`)}</loc>`,
    "  </sitemap>",
  ].join("\n")).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows}\n</sitemapindex>\n`;
}

export function pageSitemapEntries() {
  return [
    { path: "/" },
    ...publicPageSitemapEntries().map(({ path }) => ({ path })),
  ];
}

function visiblePostCandidates(database, limit = 50_000) {
  const rows = database.prepare(`SELECT p.id,p.user_id,p.artist,p.artist_key,p.review,p.photos_public,p.created_at,p.updated_at
    FROM posts p JOIN users u ON u.id=p.user_id
    WHERE p.removed=0 AND ${activeAccountSql("u")}
      AND (LENGTH(TRIM(COALESCE(p.review,'')))>=40
        OR EXISTS (SELECT 1 FROM post_media pm WHERE pm.post_id=p.id))
    ORDER BY p.created_at DESC,p.id DESC LIMIT ?`).all(limit);
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
    readyMedia: (mediaByPost.get(row.id)?.length || 0) > 0,
  }));
}

export function postSitemapEntries(database) {
  return visiblePostCandidates(database).filter((row) => row.meaningfulText || row.readyMedia).map((row) => ({
    path: postPath(row.id),
    lastmod: row.updated_at || row.created_at,
    userId: row.user_id,
  }));
}

export function profileSitemapEntries(database) {
  const postEntries = visiblePostCandidates(database);
  const latestPostByUser = new Map();
  for (const row of postEntries) {
    if (!row.meaningfulText && !(row.photos_public && row.readyMedia)) continue;
    latestPostByUser.set(row.user_id, newest(latestPostByUser.get(row.user_id), row.updated_at, row.created_at));
  }
  return database.prepare(`SELECT u.id,u.handle,u.bio,u.created_at
      FROM users u WHERE ${activeAccountSql("u")} AND (
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
      ORDER BY u.created_at DESC,u.id DESC LIMIT 50000`).all()
    .filter((row) => String(row.bio || "").replace(/\s+/g, " ").trim().length >= 60 || latestPostByUser.has(row.id))
    .map((row) => ({
      path: profilePath(row.handle),
      lastmod: newest(row.created_at, latestPostByUser.get(row.id)),
    }));
}

export function artistSitemapEntries(database, { now = Date.now() } = {}) {
  const requestedAt = Number(now);
  const at = Number.isSafeInteger(requestedAt) && requestedAt >= 0 ? requestedAt : Date.now();
  const today = new Date(at).toISOString().slice(0, 10);
  const postUpdates = new Map();
  for (const row of visiblePostCandidates(database)) {
    if (!row.meaningfulText && !(row.photos_public && row.readyMedia)) continue;
    const artistKey = String(row.artist_key || row.artist || "").trim().toLowerCase();
    if (!artistKey) continue;
    postUpdates.set(artistKey, newest(postUpdates.get(artistKey), row.updated_at, row.created_at));
  }

  const tourUpdates = new Map(database.prepare(`SELECT lower(td.artist) artist_key,MAX(td.updated_at) lastmod
    FROM tour_dates td LEFT JOIN users owner ON owner.id=td.owner_id
    WHERE trim(COALESCE(td.artist,''))<>''
      AND td.release_at<=? AND td.date>=?
      AND td.date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND (td.owner_id IS NULL OR ${activeAccountSql("owner")})
    GROUP BY lower(td.artist)`).all(at, today)
    .map((row) => [row.artist_key, Number(row.lastmod || 0)]));

  const artistRows = database.prepare(`SELECT norm,name,public_slug,bio,mbid,updated_at FROM artists
      WHERE public_slug IS NOT NULL AND trim(public_slug)<>''
      ORDER BY rank_score DESC,norm LIMIT 50000`).all();
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

  // The maps above perform the visibility work once. Correlated EXISTS
  // checks here made SQLite repeat those scans for every catalog artist and
  // blocked the single Node event loop under crawler bursts.
  return artistRows.filter((row) => memorialDetails.has(row.norm)
      || String(row.bio || "").replace(/\s+/g, " ").trim().length >= 80
      || postUpdates.has(row.norm)
      || tourUpdates.has(row.norm))
    .map((row) => ({
      path: artistPath({ name: row.name, publicSlug: row.public_slug }),
      lastmod: newest(
        row.updated_at,
        postUpdates.get(row.norm),
        tourUpdates.get(row.norm),
        memorialDetails.get(row.norm)?.updatedAt,
      ),
    }));
}

export function sitemapXmlFor(pathname, { database, env = process.env, now = Date.now() } = {}) {
  const base = publicOrigin(env);
  if (pathname === "/sitemap.xml") return sitemapIndexXml(env);
  if (pathname === "/sitemaps/pages.xml") return urlset(pageSitemapEntries(), base);
  if (!database?.prepare) return null;
  if (pathname === "/sitemaps/artists.xml") return urlset(artistSitemapEntries(database, { now }), base);
  if (pathname === "/sitemaps/posts.xml") return urlset(postSitemapEntries(database), base);
  if (pathname === "/sitemaps/profiles.xml") return urlset(profileSitemapEntries(database), base);
  return null;
}
