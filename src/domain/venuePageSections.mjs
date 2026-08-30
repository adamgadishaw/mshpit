export const VENUE_PAGE_SECTIONS = Object.freeze([
  Object.freeze({ key: "overview", label: "Overview", icon: "star" }),
  Object.freeze({ key: "shows", label: "Shows", icon: "calendar" }),
  Object.freeze({ key: "reviews", label: "Reviews", icon: "comment" }),
]);

const SECTION_KEYS = new Set(VENUE_PAGE_SECTIONS.map((section) => section.key));

export function normalizeVenuePageSection(value) {
  const key = String(value || "").trim().toLowerCase();
  return SECTION_KEYS.has(key) ? key : "overview";
}

export function venuePageSectionModel(value) {
  const active = normalizeVenuePageSection(value);
  const overview = active === "overview";
  return Object.freeze({
    active,
    condensed: overview,
    showUpcoming: overview || active === "shows",
    showReputation: overview || active === "reviews",
    showPhotos: overview || active === "reviews",
    showReviews: overview || active === "reviews",
    showHistory: active === "shows",
  });
}

export function venuePagePreview(items, { condensed = false, limit = 3 } = {}) {
  const rows = Array.isArray(items) ? items : [];
  if (!condensed) return rows;
  const requested = Number(limit);
  const take = Number.isSafeInteger(requested) && requested >= 0 ? requested : 3;
  return rows.slice(0, take);
}

export function venuePhotoViewerIndex(photos, selectedPhoto, fallbackIndex = 0) {
  const rows = Array.isArray(photos) ? photos : [];
  if (!rows.length) return 0;

  const exactIndex = rows.indexOf(selectedPhoto);
  if (exactIndex >= 0) return exactIndex;

  const selectedUri = String(selectedPhoto?.uri || "").trim();
  if (selectedUri) {
    const uriIndex = rows.findIndex((photo) => String(photo?.uri || "").trim() === selectedUri);
    if (uriIndex >= 0) return uriIndex;
  }

  const requested = Number(fallbackIndex);
  return Number.isSafeInteger(requested) ? Math.max(0, Math.min(requested, rows.length - 1)) : 0;
}
