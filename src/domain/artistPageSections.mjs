export const ARTIST_PAGE_SECTIONS = Object.freeze([
  Object.freeze({ key: "overview", label: "Overview", icon: "star" }),
  Object.freeze({ key: "shows", label: "Shows", icon: "calendar" }),
  Object.freeze({ key: "community", label: "Community", icon: "comment" }),
  Object.freeze({ key: "about", label: "About", icon: "music" }),
]);

export const ARTIST_OVERVIEW_LIMITS = Object.freeze({
  posts: 1,
  upcoming: 3,
  reviews: 1,
  gallery: 3,
  synopsisCharacters: 220,
});

const SECTION_KEYS = new Set(ARTIST_PAGE_SECTIONS.map((section) => section.key));
const LEGACY_SECTION_KEYS = new Set(["overview", "community", "about"]);
const SECTION_ALIASES = Object.freeze({ live: "shows", music: "about" });

export function artistPageSectionsForMode({ legacyMode = false } = {}) {
  return legacyMode
    ? ARTIST_PAGE_SECTIONS.filter((section) => LEGACY_SECTION_KEYS.has(section.key))
    : ARTIST_PAGE_SECTIONS;
}

export function normalizeArtistPageSection(value, { legacyMode = false } = {}) {
  const requested = String(value || "").trim().toLowerCase();
  const key = SECTION_ALIASES[requested] || requested;
  const allowed = legacyMode ? LEGACY_SECTION_KEYS : SECTION_KEYS;
  return allowed.has(key) ? key : "overview";
}

export function artistPageSectionModel(value, { legacyMode = false } = {}) {
  const active = normalizeArtistPageSection(value, { legacyMode });
  const overview = active === "overview";
  return Object.freeze({
    active,
    condensed: overview,
    legacyMode,
    showLive: !legacyMode && (overview || active === "shows"),
    showCommunity: overview || active === "community",
    showMusic: !legacyMode && active === "about",
    showAbout: active === "about" || (legacyMode && overview),
    loadFullArchive: !legacyMode && active === "shows",
    loadDiscography: !legacyMode && active === "about",
  });
}

export function artistPagePreview(items, { condensed = false, limit = 3 } = {}) {
  const rows = Array.isArray(items) ? items : [];
  if (!condensed) return rows;
  const requested = Number(limit);
  const take = Number.isSafeInteger(requested) && requested >= 0 ? requested : 3;
  return rows.slice(0, take);
}

export function artistPageSynopsis(value, { condensed = false, limit = ARTIST_OVERVIEW_LIMITS.synopsisCharacters } = {}) {
  const text = String(value || "").trim();
  if (!condensed) return { text, truncated: false };
  const requested = Number(limit);
  const take = Number.isSafeInteger(requested) && requested > 1 ? requested : ARTIST_OVERVIEW_LIMITS.synopsisCharacters;
  const characters = [...text];
  if (characters.length <= take) return { text, truncated: false };
  return {
    text: `${characters.slice(0, take - 1).join("").trimEnd()}…`,
    truncated: true,
  };
}

const cleanFact = (value) => String(value ?? "").replace(/\s+/gu, " ").trim();

export function artistPageHighlights({ upcomingCount = 0, hometown = null, country = null, memorialMode = false } = {}) {
  const highlights = [];
  const count = Math.max(0, Math.trunc(Number(upcomingCount) || 0));
  if (!memorialMode && count > 0) {
    highlights.push(Object.freeze({ key: "upcoming", label: "Upcoming", value: `${count} ${count === 1 ? "show" : "shows"}`, icon: "calendar" }));
  }
  const location = cleanFact(hometown) || cleanFact(country);
  if (location) highlights.push(Object.freeze({ key: "from", label: "From", value: location, icon: "pin" }));
  // Legacy `formed` values can be a solo artist's birth year. Verified career
  // and formation facts belong in About, with their explicit date meanings.
  return Object.freeze(highlights.slice(0, 3));
}
