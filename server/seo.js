// Server-rendered metadata, robots.txt and sitemap.xml.
//
// The app is a client-rendered bundle, so a crawler that does not execute
// JavaScript sees an empty shell — and so does every link preview: Facebook,
// iMessage, WhatsApp, Slack and Discord read the HTML and never run the app.
// Sharing an artist showed a blank card titled "Pit".
//
// Full server rendering is a much larger change. Injecting real per-URL
// metadata into the existing shell is not, and it fixes both the previews and
// what a crawler indexes, which is the part that actually matters here.

import { db, normName } from "./db.js";
import { parsePath, slugify, artistPath, venuePath, showPath, profilePath } from "../src/domain/urls.mjs";

const SITE_NAME = "Pit";
const DEFAULT_TITLE = "Pit — find out if a band is worth seeing live";
const DEFAULT_DESCRIPTION =
  "Real reviews of real gigs, from the people who were there. Rate the band, the room and the night, find who else is going, and never buy a ticket blind again.";

export const origin = () => (process.env.PUBLIC_ORIGIN || "https://www.mshpit.com").replace(/\/+$/, "");

// HTML-escape everything interpolated into a tag. Artist names and reviews are
// user- and provider-supplied, so a stray quote would otherwise break out of the
// attribute it sits in.
const esc = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// Descriptions are for a search result snippet, so they get cut at a word.
function summarize(text, max = 160) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

const jsonField = (row, field, fallback) => {
  try { return JSON.parse(row?.[field] || "null") ?? fallback; } catch { return fallback; }
};

// --- entity lookup ----------------------------------------------------------
// One namespace, so the order here IS the collision policy: a person owns their
// handle first, then artists, then venues. It must match the client's resolver.
function findByHandle(slug) {
  const row = db.prepare("SELECT id,name,handle,bio,avatar_uri,verified FROM users WHERE lower(handle)=? AND is_banned=0").get(String(slug).toLowerCase());
  if (!row) return null;
  return {
    kind: "profile",
    title: `${row.name} (@${row.handle}) — ${SITE_NAME}`,
    description: summarize(row.bio || `${row.name} reviews live music on ${SITE_NAME}. See the gigs they've been to and what they thought.`),
    image: row.avatar_uri || null,
    path: profilePath(row.handle),
    handle: row.handle,
    id: row.id,
  };
}

function findArtist(slug) {
  // Slugs are lossy, so match on the normalised name rather than storing a
  // separate slug column that could drift from the artist's actual name.
  const row = db.prepare("SELECT name,genre,bio,photo,data FROM artists WHERE norm=?").get(normName(slug.replace(/-/g, " ")))
    || db.prepare("SELECT name,genre,bio,photo,data FROM artists").all().find((r) => slugify(r.name) === slug);
  if (!row) return null;
  const stats = db.prepare("SELECT COUNT(*) c, AVG(overall) avg FROM posts WHERE removed=0 AND lower(artist)=?").get(String(row.name).toLowerCase());
  const nights = stats?.c || 0;
  const rating = nights && stats.avg ? ` Rated ${Number(stats.avg).toFixed(1)}/5 across ${nights} logged ${nights === 1 ? "night" : "nights"}.` : "";
  return {
    kind: "artist",
    title: `${row.name} live — reviews, setlists and tour dates | ${SITE_NAME}`,
    description: summarize(`${row.bio || `Is ${row.name} worth seeing live?`}${rating} Read reviews from people who were actually there.`),
    image: row.photo || jsonField(row, "data", {}).photo || null,
    path: artistPath(row.name),
    name: row.name,
  };
}

function findVenue(slug) {
  const row = db.prepare("SELECT DISTINCT venue, city FROM posts WHERE removed=0").all().find((r) => slugify(r.venue) === slug);
  if (!row) return null;
  const stats = db.prepare("SELECT COUNT(*) c, AVG(room) avg FROM posts WHERE removed=0 AND lower(venue)=?").get(String(row.venue).toLowerCase());
  const room = stats?.avg ? ` Room rated ${Number(stats.avg).toFixed(1)}/5.` : "";
  return {
    kind: "venue",
    title: `${row.venue}${row.city ? `, ${row.city}` : ""} — gig reviews | ${SITE_NAME}`,
    description: summarize(`What it's actually like to see a show at ${row.venue}.${room} Sound, sightlines and crowd, reviewed by people who were there.`),
    image: null,
    path: venuePath(row.venue),
    name: row.venue,
  };
}

function findShow(id) {
  const row = db.prepare("SELECT id,artist,venue,city,date,overall,review,photos FROM posts WHERE id=? AND removed=0").get(id);
  if (!row) return null;
  const photos = jsonField(row, "photos", []);
  return {
    kind: "show",
    title: `${row.artist} at ${row.venue}${row.date ? ` · ${row.date}` : ""} | ${SITE_NAME}`,
    description: summarize(row.review || `A review of ${row.artist} live at ${row.venue}${row.city ? ` in ${row.city}` : ""}.`),
    image: Array.isArray(photos) && photos.length ? photos[0] : null,
    path: showPath(row.id),
    show: row,
  };
}

// Returns the metadata for a path, or null when it is not a public entity.
export function metadataFor(pathname) {
  const parsed = parsePath(pathname);
  if (!parsed) return null;
  const slug = slugify(parsed.value) || String(parsed.value).toLowerCase();
  try {
    if (parsed.type === "show") return findShow(parsed.value);
    if (parsed.type === "profile") return findByHandle(parsed.value.replace(/^@/, ""));
    if (parsed.type === "artist") return findArtist(slug);
    if (parsed.type === "venue") return findVenue(slug);
    // Ambiguous root slug: handle, then artist, then venue.
    return findByHandle(parsed.value) || findArtist(slug) || findVenue(slug);
  } catch {
    // Metadata must never take the page down; the shell still renders.
    return null;
  }
}

// What the client router needs to open a URL: which kind of thing this is and
// its canonical name. Same lookup and same collision order as the metadata, so
// the page a crawler is told about is the page a visitor gets.
export function resolveEntity(pathname) {
  const meta = metadataFor(pathname);
  if (!meta) return null;
  return { kind: meta.kind, name: meta.name || null, path: meta.path, id: meta.id || meta.show?.id || null, handle: meta.handle || null };
}

// --- structured data --------------------------------------------------------
// Schema.org lets a result carry a rating or an event date in the search page
// itself, which is the difference between a blue link and a rich result.
function structuredData(meta) {
  if (!meta) return null;
  if (meta.kind === "artist") {
    return { "@context": "https://schema.org", "@type": "MusicGroup", name: meta.name, url: origin() + meta.path, ...(meta.image ? { image: meta.image } : {}) };
  }
  if (meta.kind === "show" && meta.show) {
    const s = meta.show;
    return {
      "@context": "https://schema.org",
      "@type": "MusicEvent",
      name: `${s.artist} at ${s.venue}`,
      ...(s.date ? { startDate: s.date } : {}),
      location: { "@type": "Place", name: s.venue, ...(s.city ? { address: s.city } : {}) },
      performer: { "@type": "MusicGroup", name: s.artist },
      ...(s.overall ? { review: { "@type": "Review", reviewRating: { "@type": "Rating", ratingValue: s.overall, bestRating: 5 } } } : {}),
    };
  }
  return null;
}

// Build the <head> additions for a path. Always returns a full set, falling
// back to the site defaults, so no page ever ships without a title.
export function headTagsFor(pathname) {
  const meta = metadataFor(pathname);
  const url = origin() + (meta?.path || pathname || "/");
  const title = meta?.title || DEFAULT_TITLE;
  const description = meta?.description || DEFAULT_DESCRIPTION;
  const image = meta?.image || `${origin()}/icon.png`;

  const tags = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    `<meta property="og:site_name" content="${esc(SITE_NAME)}" />`,
    `<meta property="og:type" content="${meta?.kind === "profile" ? "profile" : "website"}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:image" content="${esc(image)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
    `<meta name="twitter:image" content="${esc(image)}" />`,
  ];
  const schema = structuredData(meta);
  if (schema) tags.push(`<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, "\\u003c")}</script>`);
  return tags.join("\n    ");
}

// Replace the shell's placeholder <title> with real metadata.
export function injectHead(html, pathname) {
  return html.replace(/<title>.*?<\/title>/i, headTagsFor(pathname));
}

// --- robots.txt -------------------------------------------------------------
export function robotsTxt() {
  return [
    "# mshpit.com",
    "User-agent: *",
    "Allow: /",
    // Nothing here is secret, but these are per-account views with no value in
    // an index and they would burn crawl budget on duplicate shells.
    "Disallow: /api/",
    "Disallow: /show/*/edit",
    "",
    `Sitemap: ${origin()}/sitemap.xml`,
    "",
  ].join("\n");
}

// --- sitemap ----------------------------------------------------------------
// Only pages with something on them. A sitemap full of empty artist stubs
// teaches a search engine that the site is thin, which is worse than a smaller
// sitemap that is entirely substantial.
export function sitemapXml() {
  const base = origin();
  const urls = [{ loc: `${base}/`, priority: "1.0", changefreq: "daily" }];

  for (const row of db.prepare(`SELECT artist, COUNT(*) c, MAX(created_at) latest FROM posts
                                WHERE removed=0 AND artist<>'' GROUP BY lower(artist)`).all()) {
    urls.push({ loc: base + artistPath(row.artist), priority: "0.8", changefreq: "weekly", lastmod: row.latest });
  }
  for (const row of db.prepare(`SELECT venue, MAX(created_at) latest FROM posts
                                WHERE removed=0 AND venue<>'' GROUP BY lower(venue)`).all()) {
    urls.push({ loc: base + venuePath(row.venue), priority: "0.6", changefreq: "weekly", lastmod: row.latest });
  }
  for (const row of db.prepare(`SELECT id, created_at, updated_at FROM posts
                                WHERE removed=0 AND kind='review' ORDER BY created_at DESC LIMIT 5000`).all()) {
    urls.push({ loc: base + showPath(row.id), priority: "0.5", changefreq: "monthly", lastmod: row.updated_at || row.created_at });
  }
  // Artists with a real catalogue presence but no reviews yet still deserve
  // indexing: they are the pages a search for the band should land on.
  for (const row of db.prepare(`SELECT name FROM artists WHERE photo IS NOT NULL AND popularity IS NOT NULL
                                ORDER BY rank_score DESC LIMIT 2000`).all()) {
    const loc = base + artistPath(row.name);
    if (!urls.some((u) => u.loc === loc)) urls.push({ loc, priority: "0.4", changefreq: "monthly" });
  }

  const entries = urls.map((u) => [
    "  <url>",
    `    <loc>${esc(u.loc)}</loc>`,
    u.lastmod ? `    <lastmod>${new Date(Number(u.lastmod)).toISOString().slice(0, 10)}</lastmod>` : null,
    `    <changefreq>${u.changefreq}</changefreq>`,
    `    <priority>${u.priority}</priority>`,
    "  </url>",
  ].filter(Boolean).join("\n")).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}
