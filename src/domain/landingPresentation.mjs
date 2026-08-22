const boundedCount = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
};

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
  return [
    {
      key: "venues",
      icon: "pin",
      title: "VENUES",
      detail: `${boundedCount(venues).toLocaleString("en-US")} in the PIT catalogue`,
    },
    {
      key: "artists",
      icon: "music",
      title: "ARTISTS",
      detail: `${boundedCount(artists).toLocaleString("en-US")} in the PIT catalogue`,
    },
    {
      key: "ratings",
      icon: "star",
      title: "BAND + ROOM",
      detail: "Rated separately",
    },
  ];
}
