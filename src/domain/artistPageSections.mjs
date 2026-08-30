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
