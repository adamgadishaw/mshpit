// Public URLs for the things people share and search engines index.
//
// The app was a single URL: every artist, venue and show lived at `mshpit.com/`
// and navigation only ever pushed empty history entries. A link to a band could
// not be shared, a refresh lost your place, and there was nothing for a crawler
// to index except the home page. Meta tags and sitemaps are worthless until the
// pages they describe have addresses.
//
// Canonical public identities own explicit namespaces. That keeps a member,
// artist, and venue with the same readable name from silently taking over one
// another's shared link. Legacy root vanity paths remain parseable below so an
// older bookmark can still reach the resolver and be redirected by the server.

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
  // Public route prefixes must be reserved as ROOT slugs too, or a band
  // called "Artist" builds "/artist", which parsePath reads as a prefix with no
  // value and rejects. That put a dead link in the sitemap.
  "artist", "artists", "venue", "u", "post", "show", "event", "events", "concert", "concerts",
  "about", "admin", "api", "assets", "auth", "badges", "calendar", "clips",
  "contact", "discover", "download", "edit", "explore", "favicon.ico", "feed",
  "help", "home", "inbox", "legal", "login", "logout", "menu", "messages",
  "nearby", "new", "notifications", "playlist", "playlists", "press",
  "privacy", "profile", "public", "robots.txt", "search", "settings", "show",
  "signup", "sitemap.xml", "static", "support", "terms", "tour", "venues",
  "you", "account-deletion", "_expo",
]);

export const isReservedSlug = (slug) => RESERVED_SLUGS.has(String(slug || "").toLowerCase());

// An artist's stored publicSlug is immutable. The name fallback keeps callers
// from manufacturing a dead link while older API payloads roll forward, but a
// discovered publicSlug always wins so punctuation/collision changes cannot
// move an established page.
export const artistPath = (artistOrName, publicSlug = null) => {
  const artist = artistOrName && typeof artistOrName === "object" ? artistOrName : null;
  const name = artist ? artist.name : artistOrName;
  const stableSlug = publicSlug || artist?.publicSlug || artist?.public_slug || null;
  const slug = slugify(stableSlug || name);
  return slug ? `/artist/${slug}` : null;
};

export const postPath = (id) => {
  const value = String(id ?? "");
  return value ? `/post/${encodeURIComponent(value)}` : null;
};

// Compatibility name for code that still calls a logged review a "show".
// Its generated URL is canonical; parsePath continues accepting legacy /show.
export const showPath = postPath;
// Venue names historically occupied the ambiguous root namespace. Always emit
// the explicit namespace now; the resolver still accepts old root links and
// redirects them, so an artist/member with the same slug can never steal a
// newly shared venue URL.
export const venuePath = (venueOrName) => {
  const venue = venueOrName && typeof venueOrName === "object" ? venueOrName : null;
  const slug = slugify(venue?.publicSlug || venue?.public_slug || venue?.name || venueOrName);
  if (!slug) return null;
  const providerId = String(venue?.providerVenueId || venue?.venue_provider_id || "").trim();
  const providerSource = slugify(venue?.source || "");
  const providerSlug = slugify(providerId);
  // Provider venues get a durable disambiguator. A human venue name can be
  // corrected and many cities have identically named rooms; the provider key
  // keeps those pages from collapsing into one search identity.
  if (providerSlug) return `/venue/${providerSource ? `${providerSource}-` : "provider-"}${providerSlug}`;
  return `/venue/${slug}`;
};

// Provider event ids are already durable, opaque identities. Keep the id as
// the sole canonical segment so a corrected artist, venue, or localized event
// name does not move the page or split its search history.
export const eventPath = (eventOrId) => {
  const id = eventOrId && typeof eventOrId === "object" ? eventOrId.id : eventOrId;
  const value = String(id ?? "").trim();
  return value ? `/event/${encodeURIComponent(value)}` : null;
};

// Fan concert archives currently use an identity-bound opaque show key. It is
// collision-safe and survives display-label correction better than a pretty
// name/date slug. A future persistent concert table can redirect these paths
// without breaking links already shared by fans.
export const concertPath = (showKey) => {
  const value = String(showKey ?? "").trim();
  return value ? `/concert/${encodeURIComponent(value)}` : null;
};
export const profilePath = (handle) => {
  const clean = String(handle || "").replace(/^@/, "").toLowerCase();
  if (!clean) return null;
  return `/u/${encodeURIComponent(clean)}`;
};


const COLLECTION_ROOTS = Object.freeze({ artists: "/artists", events: "/events", venues: "/venues", concerts: "/concerts" });
const positivePage = (value) => { const page = Number(value ?? 1); return Number.isSafeInteger(page) && page >= 1 ? page : null; };
export function paginatedPath(root, page = 1) {
  const cleanPage = positivePage(page);
  if (!Object.values(COLLECTION_ROOTS).includes(root) || !cleanPage) return null;
  return cleanPage === 1 ? root : `${root}/page/${cleanPage}`;
}
export const artistsPath = (page = 1) => paginatedPath(COLLECTION_ROOTS.artists, page);
export const eventsPath = (page = 1) => paginatedPath(COLLECTION_ROOTS.events, page);
export const venuesPath = (page = 1) => paginatedPath(COLLECTION_ROOTS.venues, page);
export const concertsPath = (page = 1) => paginatedPath(COLLECTION_ROOTS.concerts, page);
function structuredCityParts(value) {
  const countryCode = String(value?.countryCode || value?.venueCountryCode || value?.venue_country_code || "").trim().toLowerCase();
  const citySlug = slugify(value?.city || value?.venueCity || value?.venue_city || "");
  return /^[a-z]{2}$/.test(countryCode) && citySlug ? { countryCode, citySlug } : null;
}
function cityCollectionPath(kind, value, page = 1) {
  const city = structuredCityParts(value), cleanPage = positivePage(page);
  if (!city || !cleanPage || !["venues", "concerts"].includes(kind)) return null;
  const root = `/${kind}/${city.countryCode}/${city.citySlug}`;
  return cleanPage === 1 ? root : `${root}/page/${cleanPage}`;
}
export const cityVenuesPath = (value, page = 1) => cityCollectionPath("venues", value, page);
export const cityConcertsPath = (value, page = 1) => cityCollectionPath("concerts", value, page);
export function artistConcertsPath(artistOrSlug, page = 1) {
  const artist = artistOrSlug && typeof artistOrSlug === "object" ? artistOrSlug : null;
  const slug = slugify(artist?.publicSlug || artist?.public_slug || artistOrSlug), cleanPage = positivePage(page);
  if (!slug || !cleanPage) return null;
  const root = `/artist/${slug}/concerts`;
  return cleanPage === 1 ? root : `${root}/page/${cleanPage}`;
}
function parsedPage(parts, start) {
  if (parts.length === start) return { page: 1, nonCanonicalPageOne: false };
  if (parts.length !== start + 2 || parts[start]?.toLowerCase() !== "page" || !/^\d+$/.test(parts[start + 1])) return null;
  const page = positivePage(parts[start + 1]);
  return page ? { page, nonCanonicalPageOne: page === 1 } : null;
}
export function parsePublicCollectionPath(pathname) {
  const parts = String(pathname || "/").split("?")[0].split("#")[0].split("/").filter(Boolean);
  if (!parts.length) return null;
  const head = parts[0].toLowerCase();
  if (["artists", "events"].includes(head)) { const pagination = parsedPage(parts, 1); return pagination ? { type: head, ...pagination } : null; }
  if (["venues", "concerts"].includes(head)) {
    if (parts.length === 1 || parts[1]?.toLowerCase() === "page") { const pagination = parsedPage(parts, 1); return pagination ? { type: head, ...pagination } : null; }
    const countryCode = parts[1]?.toLowerCase(), citySlug = parts[2]?.toLowerCase();
    if (!/^[a-z]{2}$/.test(countryCode) || !citySlug || slugify(citySlug) !== citySlug) return null;
    const pagination = parsedPage(parts, 3);
    return pagination ? { type: head === "venues" ? "city-venues" : "city-concerts", countryCode, citySlug, ...pagination } : null;
  }
  if (head === "artist" && parts.length >= 3 && parts[2]?.toLowerCase() === "concerts") {
    const artistSlug = parts[1]?.toLowerCase();
    if (!artistSlug || slugify(artistSlug) !== artistSlug) return null;
    const pagination = parsedPage(parts, 3);
    return pagination ? { type: "artist-concerts", artistSlug, ...pagination } : null;
  }
  return null;
}/**
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

  const decode = (value) => {
    try { return decodeURIComponent(value); } catch { return null; }
  };

  if (lower === "post" || lower === "show") {
    const id = decode(rest.join("/") || "");
    return id ? { type: "show", value: id } : null;
  }
  if (lower === "event" || lower === "concert") {
    const value = decode(rest.join("/") || "");
    if (!value) return null;
    return { type: lower, value };
  }
  // Legacy/explicit forms stay understood so old links keep working.
  if (lower === "artist" || lower === "venue" || lower === "u") {
    const value = decode(rest.join("/") || "");
    if (!value) return null;
    return { type: lower === "u" ? "profile" : lower, value };
  }
  if (rest.length) return null;              // no unknown nested paths
  if (isReservedSlug(lower)) return null;    // the app's own screens
  const value = decode(head);
  return value ? { type: "entity", value } : null;
}

export const isPublicEntityPath = (pathname) => parsePath(pathname) !== null;
