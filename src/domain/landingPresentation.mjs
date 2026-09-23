const boundedCount = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
};

// The landing says what Mshpit is in words another music app could not borrow
// unchanged: keep the shows you went to, rate the artist and the room on their
// own, and see the night through the people who were there. One headline, one
// sentence, two actions. Keep them here so responsive variants cannot drift.
export const LANDING_IDENTITY_COPY = Object.freeze({
  headline: "Remember every show.",
  // Phones break the headline on purpose instead of stranding one word.
  compactHeadline: "Remember\nevery show.",
  body: "Log the concerts you go to, rate the artist and the venue separately, and see photos and reviews from people who were there.",
  signupAction: "Create an account",
  browseAction: "Browse concerts",
});

export const LANDING_BROWSE_LINKS = Object.freeze([
  { key: "artists", href: "/artists", label: "Artists" },
  { key: "venues", href: "/venues", label: "Venues" },
  { key: "cities", href: "/cities", label: "Cities" },
]);

// Keep the hero's layout decisions in one pure model. Width alone is not
// enough: a landscape laptop window can be wide and still too short for a
// bottom-anchored pitch once text scaling is applied.
export function landingLayoutMode({ width, height, fontScale = 1 } = {}) {
  const viewportWidth = boundedCount(width);
  const viewportHeight = boundedCount(height);
  const wide = viewportWidth >= 900;
  const compact = viewportWidth < 520;
  const short = viewportHeight > 0 && viewportHeight < 700;
  const largeType = Number(fontScale) > 1.35;
  return {
    wide,
    compact,
    scrollPitch: !wide || short || largeType,
    overlayCredit: wide && !short && !largeType,
  };
}
