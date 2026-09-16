const DIMENSIONS = ["performance", "setlist", "sound", "venue", "crowd", "experience"];
const positiveRating = (value) => {
  if (value == null || typeof value === "boolean") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 && numeric <= 5 ? numeric : null;
};
const averageRated = (values) => {
  const rated = values.map(positiveRating).filter((value) => value !== null);
  return rated.length ? rated.reduce((sum, value) => sum + value, 0) / rated.length : null;
};

// Zero means "not rated" in persisted dimensions, not a zero-star review.
// Explicit dimensions win over legacy aggregates; unknown categories stay out
// of the summary instead of diluting the categories the member did rate.
export function reviewRatingSummary(post = {}) {
  const dims = post?.dims && typeof post.dims === "object" ? post.dims : {};
  const hasDimensions = DIMENSIONS.some((key) => Object.hasOwn(dims, key));
  const band = hasDimensions ? averageRated([dims.performance, dims.setlist]) : positiveRating(post.band);
  const room = hasDimensions ? averageRated([dims.sound, dims.venue]) : positiveRating(post.room);
  const night = hasDimensions ? averageRated([dims.crowd, dims.experience]) : null;
  const factors = [["Band", band], ["Room", room], ["Night", night]]
    .filter(([, value]) => value !== null)
    .map(([label, value]) => `${label} ${value.toFixed(1)}`).join(" · ");
  return { band, room, night, overall: positiveRating(post.overall) || 0, factors, hasDimensions };
}
