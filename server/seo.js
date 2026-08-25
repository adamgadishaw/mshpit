// Public discovery documents, canonical URL resolution, and crawler controls.
//
// The interactive app remains an Expo web bundle. Public entity routes receive
// meaningful HTML inside #root before that bundle mounts, so people without
// JavaScript, link-preview bots, and search crawlers all see the same public
// facts. React replaces the preview when it starts; private/session state is
// never projected into this layer.

import { db, artistStmts, normName } from "./db.js";
import { activeAccountSql } from "./accountVisibility.js";
import { isProduction } from "./environment.js";
import {
  artistPath,
  parsePath,
  postPath,
  profilePath,
  venuePath,
} from "../src/domain/urls.mjs";
import {
  createPublicDocumentService,
  renderPublicDocumentHead,
  renderPublicDocumentShell,
} from "./features/seo/publicDocuments.js";
import {
  sitemapIndexXml,
  sitemapXmlFor,
} from "./features/seo/sitemapService.js";

const SITE_NAME = "Mshpit";
const DEFAULT_TITLE = "Mshpit — Your life's musical journey";
const DEFAULT_DESCRIPTION =
  "Log the concerts that shape your story, share the nights you were there, and discover live music through people whose taste you trust.";

function configuredOrigin(env = process.env) {
  try {
    const parsed = new URL(env.PUBLIC_ORIGIN || "https://www.mshpit.com");
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new TypeError("Unsupported public origin");
    return parsed.origin;
  } catch {
    return "https://www.mshpit.com";
  }
}

export const origin = () => configuredOrigin(process.env);

const publicDocuments = createPublicDocumentService({
  database: db,
  origin: origin(),
  paths: {
    artist: (row) => artistPath({
      name: row?.name,
      public_slug: row?.public_slug || row?.artist_public_slug,
    }),
    member: (row) => profilePath(row?.u_handle || row?.handle),
    post: (row) => postPath(row?.id),
  },
});

const memberByHandle = db.prepare(`SELECT u.id,u.name,u.handle FROM users u
  WHERE u.handle=? AND ${activeAccountSql("u")} LIMIT 1`);
const venueByKey = db.prepare(`SELECT p.venue,p.city FROM posts p JOIN users u ON u.id=p.user_id
  WHERE p.venue_key=? AND p.removed=0 AND ${activeAccountSql("u")}
  ORDER BY p.created_at DESC,p.id DESC LIMIT 1`);
const publicPostIdentity = db.prepare(`SELECT p.id FROM posts p JOIN users u ON u.id=p.user_id
  WHERE p.id=? AND p.removed=0 AND ${activeAccountSql("u")} LIMIT 1`);

const esc = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

function cleanPathname(value) {
  const pathname = String(value || "/");
  if (!pathname.startsWith("/") || pathname.length > 500 || /[\u0000-\u001f\u007f\\]/.test(pathname)) return null;
  return pathname;
}

function artistResolution(slug) {
  const artist = artistStmts.byPublicSlug.get(String(slug || "").trim());
  if (!artist) return null;
  const path = artistPath(artist);
  return {
    entity: { kind: "artist", name: artist.name, path },
    canonicalPath: path,
    documentRequest: { kind: "artist", artistKey: artist.norm, canonicalPath: path },
  };
}

function memberResolution(handle) {
  const member = memberByHandle.get(String(handle || "").replace(/^@+/, "").toLowerCase());
  if (!member) return null;
  const path = profilePath(member.handle);
  return {
    entity: { kind: "profile", name: member.name, handle: member.handle, id: member.id, path },
    canonicalPath: path,
    documentRequest: { kind: "member", id: member.id, canonicalPath: path },
  };
}

function postResolution(id) {
  const post = publicPostIdentity.get(String(id || ""));
  if (!post) return null;
  const path = postPath(id);
  return {
    // The client still calls a logged review a "show" internally. Its public
    // identity is /post/:id; this compatibility value does not affect schema.
    entity: { kind: "show", id: String(id), path },
    canonicalPath: path,
    documentRequest: { kind: "post", id: post.id, canonicalPath: path },
  };
}

function venueResolution(value) {
  const key = normName(String(value || "").replace(/-/g, " "));
  const venue = key ? venueByKey.get(key) : null;
  if (!venue) return null;
  const path = venuePath(venue.venue);
  return {
    entity: { kind: "venue", name: venue.venue, path },
    canonicalPath: path,
  };
}

function hydrateResolution(resolution) {
  if (!resolution) return null;
  if (!resolution?.documentRequest) return { ...resolution, document: null };
  const document = safePublicDocument(() => publicDocuments.documentFor(resolution.documentRequest));
  return { ...resolution, document: document || null };
}

function safePublicDocument(read) {
  try {
    return read();
  } catch (error) {
    const cause = error instanceof Error && error.name ? error.name : "UnknownError";
    console.error(`[seo] public document projection unavailable: cause=${cause}`);
    return null;
  }
}

function entityResolution(pathname) {
  const parsed = parsePath(pathname);
  if (!parsed) return null;

  if (parsed.type === "artist") return artistResolution(parsed.value);
  if (parsed.type === "profile") return memberResolution(parsed.value);
  if (parsed.type === "show") return postResolution(parsed.value);
  if (parsed.type === "venue") return venueResolution(parsed.value);

  // Legacy root vanity links had one shared namespace. Preserve their original
  // collision policy, then redirect profiles/artists to explicit canonicals.
  return memberResolution(parsed.value)
    || artistResolution(parsed.value)
    || venueResolution(parsed.value);
}

export function resolveEntity(pathname) {
  const path = cleanPathname(pathname);
  return path ? entityResolution(path)?.entity || null : null;
}

const APP_SCREENS = new Set([
  "/about", "/admin", "/badges", "/calendar", "/clips", "/discover",
  "/download", "/feed", "/help", "/home", "/inbox", "/login", "/menu",
  "/messages", "/moderation", "/nearby", "/new", "/notifications",
  "/playlist", "/playlists", "/search", "/settings", "/signup", "/tour",
  "/venues", "/you",
]);

function publicRoute(pathname) {
  const path = cleanPathname(pathname);
  if (!path) return { type: "not-found", status: 404 };
  if (path === "/") {
    const document = safePublicDocument(() => publicDocuments.homeDocument({ canonicalPath: "/" }));
    if (!document) return { type: "app", status: 200 };
    return {
      type: "document",
      status: 200,
      canonicalPath: "/",
      document,
    };
  }

  const parsed = parsePath(path);
  if (parsed) {
    const identity = entityResolution(path);
    if (!identity) return { type: "not-found", status: 404 };
    if (identity.canonicalPath && identity.canonicalPath !== path) {
      return { type: "redirect", status: 301, location: identity.canonicalPath, entity: identity.entity };
    }
    const resolution = hydrateResolution(identity);
    if (resolution.document && documentIsIndexable(resolution.document)) {
      return { type: "document", status: 200, ...resolution };
    }
    if (resolution.document) return { type: "app", status: 200, entity: resolution.entity };
    // Venue identity is not stable enough for a search canonical yet. Keep its
    // interactive route but explicitly withhold it from indexing.
    return { type: "app", status: 200, entity: resolution.entity };
  }

  if (APP_SCREENS.has(path.toLowerCase())) return { type: "app", status: 200 };
  return { type: "not-found", status: 404 };
}

function substantiveText(value, minimum) {
  return String(value || "").replace(/\s+/g, " ").trim().length >= minimum;
}

function documentIsIndexable(document) {
  if (!document) return false;
  if (document.kind === "home") return true;
  if (document.kind === "artist") {
    return substantiveText(document.memorial?.summary, 20)
      || substantiveText(document.artist?.bio, 80)
      || document.reviews?.some((review) => substantiveText(review.text, 40) || review.media?.length)
      || document.events?.length > 0;
  }
  if (document.kind === "member") {
    return substantiveText(document.member?.bio, 60)
      || document.posts?.some((post) => substantiveText(post.text, 40) || post.media?.length);
  }
  if (document.kind === "post") {
    return substantiveText(document.post?.text, 40) || document.post?.media?.length > 0;
  }
  return false;
}

export function seoHttpPlan(pathname) {
  return publicRoute(pathname);
}

function legacyMetadata(resolution) {
  if (!resolution) return null;
  const { document, entity } = resolution;
  if (!document) {
    if (entity?.kind !== "venue") return null;
    return {
      kind: "venue",
      name: entity.name,
      path: entity.path,
      title: `${entity.name} — live music on Mshpit`,
      description: `Open ${entity.name} on Mshpit.`,
      image: null,
    };
  }
  const kind = document.kind === "member" ? "profile" : document.kind === "post" ? "show" : document.kind;
  return {
    kind,
    name: document.artist?.name || document.member?.name || null,
    handle: document.member?.handle || null,
    id: document.post?.id || entity?.id || null,
    path: document.canonicalPath,
    title: document.title,
    description: document.description,
    image: document.image,
    ...(kind === "show" ? {
      show: {
        id: document.post.id,
        artist: document.post.artist,
        venue: document.post.venue,
        city: document.post.city,
        date: document.post.showDate,
        overall: document.post.rating,
        review: document.post.text,
      },
    } : {}),
  };
}

export function metadataFor(pathname) {
  const path = cleanPathname(pathname);
  return path ? legacyMetadata(hydrateResolution(entityResolution(path))) : null;
}

function defaultHead(pathname, { noindex = true } = {}) {
  const path = cleanPathname(pathname) || "/";
  const url = `${origin()}${path}`;
  const image = `${origin()}/og.png`;
  return `<title>${esc(DEFAULT_TITLE)}</title>
    <meta name="description" content="${esc(DEFAULT_DESCRIPTION)}" />
    ${noindex ? '<meta name="robots" content="noindex,follow" />' : ""}
    <meta property="og:site_name" content="${SITE_NAME}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${esc(DEFAULT_TITLE)}" />
    <meta property="og:description" content="${esc(DEFAULT_DESCRIPTION)}" />
    <meta property="og:url" content="${esc(url)}" />
    <meta property="og:image" content="${esc(image)}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />`;
}

export function headTagsFor(pathname) {
  const route = publicRoute(pathname);
  return route.type === "document" && route.document
    ? renderPublicDocumentHead(route.document)
    : defaultHead(pathname);
}

function replaceHead(html, tags) {
  const withoutTitle = String(html).replace(/\s*<title[^>]*>[\s\S]*?<\/title>/i, "");
  return withoutTitle.replace(/<\/head>/i, `    ${tags}\n  </head>`);
}

export function injectHead(html, pathname, resolvedRoute = null) {
  const route = resolvedRoute || publicRoute(pathname);
  let output = replaceHead(html, route.type === "document" && route.document
    ? renderPublicDocumentHead(route.document)
    : defaultHead(pathname));
  if (route.type === "document" && route.document) {
    const shell = renderPublicDocumentShell(route.document);
    if (shell) output = output.replace(/<div\s+id=["']root["']\s*><\/div>/i, `<div id="root">${shell}</div>`);
  }
  return output;
}

export function renderNotFoundDocument() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Page not found | Mshpit</title><meta name="robots" content="noindex,follow" />
  <style>body{margin:0;background:#080807;color:#f8f4ec;font:16px/1.5 system-ui;display:grid;min-height:100vh;place-items:center}main{max-width:42rem;padding:2rem}p:first-child{color:#f4b72a;font:800 .75rem monospace;letter-spacing:.15em;text-transform:uppercase}h1{font:900 clamp(3rem,10vw,6rem)/.95 Georgia,serif;margin:.4rem 0}p{color:#bdb4aa}a{display:inline-block;margin-top:1rem;border-radius:999px;background:#f4b72a;color:#150f05;padding:.8rem 1.1rem;text-decoration:none;font-weight:800}</style>
</head><body><main><p>Lost in the crowd</p><h1>That page isn't here.</h1><p>The link may be old, private, or removed.</p><a href="/">Back to Mshpit</a></main></body></html>`;
}

export function robotsTxt() {
  if (!isProduction()) {
    return ["# staging — not for indexing", "User-agent: *", "Disallow: /", ""].join("\n");
  }
  return [
    "# mshpit.com",
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "Disallow: /admin",
    "Disallow: /moderation",
    "Disallow: /messages",
    "Disallow: /notifications",
    "Disallow: /settings",
    "Disallow: /you",
    "",
    `Sitemap: ${origin()}/sitemap.xml`,
    "",
  ].join("\n");
}

export function sitemapXml() {
  return sitemapIndexXml(process.env);
}

const SITEMAP_CACHE_TTL_MS = 5 * 60 * 1000;
const sitemapCache = new Map();

export function sitemapForPath(pathname) {
  const path = cleanPathname(pathname);
  if (!path) return null;
  const at = Date.now();
  const cached = sitemapCache.get(path);
  if (cached && at - cached.at < SITEMAP_CACHE_TTL_MS) return cached.body;
  const body = sitemapXmlFor(path, { database: db, env: process.env, now: at });
  if (body != null) sitemapCache.set(path, { at, body });
  return body;
}
