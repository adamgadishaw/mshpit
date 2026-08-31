const boundedCount = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
};

const optionalCount = (value) => {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : null;
};

// PIT's landing voice should describe the actual product in a way another
// music app could not borrow unchanged: remember the shows, express taste,
// and find the next night through the people around them. Keep these lines in
// one presentation contract so responsive variants and future redesigns do
// not drift back into generic journal or social-network language.
export const LANDING_IDENTITY_COPY = Object.freeze({
  kicker: "REMEMBER THE NIGHT. FIND WHAT'S NEXT.",
  compactKicker: "REMEMBER. RATE. DISCOVER.",
  headline: "The shows you saw.",
  headlineAccent: "The taste you built.",
  body: "Remember every show with photos, ratings, and the people who were there. Discover your next night through fans whose taste you trust.",
  signupAction: "Create an account",
  browseAction: "Browse shows and artists",
});

export function landingKicker(compact = false) {
  return compact ? LANDING_IDENTITY_COPY.compactKicker : LANDING_IDENTITY_COPY.kicker;
}

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

// Landing proof stays grounded in the shipped catalogue and product behavior.
// There is deliberately no account/member metric here: PIT should earn trust
// by explaining the product, not by turning its signup total into social proof.
export function landingProofItems({ venues, artists } = {}) {
  const venueCount = optionalCount(venues);
  const artistCount = optionalCount(artists);
  return [
    {
      key: "venues",
      icon: "pin",
      title: "VENUES",
      detail: venueCount == null ? "Concert venues to explore" : `${venueCount.toLocaleString("en-US")} concert venues`,
    },
    {
      key: "artists",
      icon: "music",
      title: "ARTISTS",
      detail: artistCount == null ? "Artists to explore" : `${artistCount.toLocaleString("en-US")} artists`,
    },
    {
      key: "ratings",
      icon: "star",
      title: "ARTIST + VENUE",
      detail: "Rate the artist and venue separately",
    },
  ];
}
