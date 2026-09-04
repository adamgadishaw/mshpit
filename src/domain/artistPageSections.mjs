export const ARTIST_PAGE_SECTIONS = Object.freeze([
  Object.freeze({ key: "overview", label: "Overview", icon: "star" }),
  Object.freeze({ key: "live", label: "Live", icon: "calendar" }),
  Object.freeze({ key: "community", label: "Community", icon: "comment" }),
  Object.freeze({ key: "music", label: "Music", icon: "music" }),
]);

export const ARTIST_OVERVIEW_LIMITS = Object.freeze({
  posts: 1,
  upcoming: 3,
  reviews: 1,
  gallery: 3,
  synopsisCharacters: 220,
});

const SECTION_KEYS = new Set(ARTIST_PAGE_SECTIONS.map((section) => section.key));

export function normalizeArtistPageSection(value) {
  const key = String(value || "").trim().toLowerCase();
  return SECTION_KEYS.has(key) ? key : "overview";
}

export function artistPageSectionModel(value) {
  const active = normalizeArtistPageSection(value);
  const overview = active === "overview";
  return Object.freeze({
    active,
    condensed: overview,
    showLive: overview || active === "live",
    showCommunity: overview || active === "community",
    showMusic: active === "music",
    showAbout: overview,
    loadFullArchive: active === "live",
    loadDiscography: active === "music",
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

export function artistPageHighlights({ upcomingCount = 0, hometown = null, country = null, formed = null, memorialMode = false } = {}) {
  const highlights = [];
  const count = Math.max(0, Math.trunc(Number(upcomingCount) || 0));
  if (!memorialMode && count > 0) {
    highlights.push(Object.freeze({ key: "upcoming", label: "Upcoming", value: `${count} ${count === 1 ? "show" : "shows"}`, icon: "calendar" }));
  }
  const location = cleanFact(hometown) || cleanFact(country);
  if (location) highlights.push(Object.freeze({ key: "from", label: "From", value: location, icon: "pin" }));
  const year = cleanFact(formed).match(/^(?:18|19|20)\d{2}$/u)?.[0] || "";
  if (year) highlights.push(Object.freeze({ key: "started", label: "Started", value: year, icon: "clock" }));
  return Object.freeze(highlights.slice(0, 3));
}
