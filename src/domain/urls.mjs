// Public URLs for the things people share and search engines index.
//
// The app was a single URL: every artist, venue and show lived at `mshpit.com/`
// and navigation only ever pushed empty history entries. A link to a band could
// not be shared, a refresh lost your place, and there was nothing for a crawler
// to index except the home page. Meta tags and sitemaps are worthless until the
// pages they describe have addresses.
//
// The scheme is Facebook's: vanity names live at the ROOT (`mshpit.com/zuck`,
// `mshpit.com/turnstile`), and only things identified by an opaque id sit under
// a prefix (`/show/<id>`, like `facebook.com/events/<id>`). That means one
// global namespace shared by handles, artists and venues, so it needs two
// things a prefixed scheme would not: a reserved list, and a fixed resolution
// order for collisions.

export const slugify = (value) =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")   // strip accents
    .replace(/&/g, " and ")
    .toLowerCase()
    .replace(/['’]/g, "")              // O'Brien -> obrien, not o-brien
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

// Words the app itself owns. A band called "Search" must not be able to take
// over the search screen, and these also keep future routes free. Handles are
// validated against this list at signup for the same reason.
export const RESERVED_SLUGS = new Set([
  // The four route prefixes below must be reserved as ROOT slugs too, or a band
  // called "Artist" builds "/artist", which parsePath reads as a prefix with no
  // value and rejects. That put a dead link in the sitemap.
  "artist", "venue", "u", "show",
  "about", "admin", "api", "assets", "auth", "badges", "calendar", "clips",
  "contact", "discover", "download", "edit", "explore", "favicon.ico", "feed",
  "help", "home", "inbox", "legal", "login", "logout", "menu", "messages",
  "nearby", "new", "notifications", "playlist", "playlists", "post", "press",
  "privacy", "profile", "public", "robots.txt", "search", "settings", "show",
  "signup", "sitemap.xml", "static", "support", "terms", "tour", "venues",
  "you", "_expo",
]);

export const isReservedSlug = (slug) => RESERVED_SLUGS.has(String(slug || "").toLowerCase());

// A show is a specific night, identified by an id rather than a name, so it
// keeps a prefix. Everything else is a vanity path at the root.
//
// One exception, and it is not hypothetical: a band called "Search" or "Artist"
// slugifies onto a word the app owns. Those fall back to the explicit prefixed
// form so the URL still resolves instead of silently becoming a dead link in
// the sitemap. Every path these build must parse back to the same entity, which
// `urls.test.mjs` asserts.
const vanity = (prefix, name) => {
  const slug = slugify(name);
  if (!slug) return null;
  return isReservedSlug(slug) ? `/${prefix}/${slug}` : `/${slug}`;
};

export const showPath = (id) => `/show/${encodeURIComponent(id)}`;
export const artistPath = (name) => vanity("artist", name);
export const venuePath = (name) => vanity("venue", name);
export const profilePath = (handle) => {
  const clean = String(handle || "").replace(/^@/, "").toLowerCase();
  if (!clean) return null;
  return isReservedSlug(clean) ? `/u/${clean}` : `/${clean}`;
};

/**
 * Parse a pathname into something the app can open.
 *
 * A root slug is ambiguous by construction: `/turnstile` could be a handle, an
 * artist or a venue. Rather than guess here, this returns `{ type: "entity" }`
 * and lets the resolver decide, so the client and the server both apply the
 * same order. That order is handle first (a person owns their name and it is
 * already unique and validated), then artist, then venue.
 */
export function parsePath(pathname) {
  const clean = String(pathname || "/").split("?")[0].split("#")[0];
  const parts = clean.split("/").filter(Boolean);
  if (!parts.length) return null;

  const [head, ...rest] = parts;
  const lower = head.toLowerCase();

  if (lower === "show") {
    const id = decodeURIComponent(rest.join("/") || "");
    return id ? { type: "show", value: id } : null;
  }
  // Legacy/explicit forms stay understood so old links keep working.
  if (lower === "artist" || lower === "venue" || lower === "u") {
    const value = decodeURIComponent(rest.join("/") || "");
    if (!value) return null;
    return { type: lower === "u" ? "profile" : lower, value };
  }
  if (rest.length) return null;              // no unknown nested paths
  if (isReservedSlug(lower)) return null;    // the app's own screens
  return { type: "entity", value: decodeURIComponent(head) };
}

export const isPublicEntityPath = (pathname) => parsePath(pathname) !== null;
