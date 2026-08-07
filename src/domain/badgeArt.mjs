// Art vocabulary for admin-created badges.
//
// Custom badges reuse the existing seal in components/Badge.jsx rather than
// accepting uploaded images. Two reasons: every badge stays on-brand at any size,
// and an admin never supplies a raw colour or asset that reaches an SVG
// attribute. Admins pick a NAME from these tables; the values live here.
//
// Shared by the server (which validates) and the client (which renders), so the
// two cannot drift into disagreeing about what a badge looks like.

export const BADGE_COLORS = {
  cool: { fill: "#2E7BE0", edge: "#123A6B", label: "Blue" },
  gold: { fill: "#E8B65A", edge: "#7A5A12", label: "Gold" },
  violet: { fill: "#A855F7", edge: "#4C1D95", label: "Violet" },
  magenta: { fill: "#E0457B", edge: "#5E1633", label: "Magenta" },
  green: { fill: "#3BA55D", edge: "#14512F", label: "Green" },
  amber: { fill: "#F2A65A", edge: "#6B3410", label: "Amber" },
  silver: { fill: "#C7CDD6", edge: "#6E7784", label: "Silver" },
  bronze: { fill: "#D08A55", edge: "#7A4A22", label: "Bronze" },
};

// `char` renders a single character inside the seal, which is what makes an
// event badge legible without new artwork: "V" for VIP, "1" for a first-year
// member, and so on.
export const BADGE_GLYPHS = { check: "Tick", star: "Star", char: "A letter or number" };

export const BADGE_KINDS = {
  tier: "Tier",     // a level: VIP, Early Access, Founding Member
  event: "Event",   // tied to a specific occasion
  status: "Status", // an ongoing mark
};

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;

// Reserved so a custom badge can never impersonate a built-in one. `verified`
// especially: that seal means "identity confirmed by the Pit team", and an
// admin-made lookalike would quietly devalue it.
export const RESERVED_SLUGS = new Set([
  "verified", "sponsor", "top100", "rank1", "rank2", "rank3", "staff", "mod", "founder", "artist",
]);

export function badgeArt({ color, glyph, glyphChar }) {
  const palette = BADGE_COLORS[color] || BADGE_COLORS.cool;
  const kind = BADGE_GLYPHS[glyph] ? glyph : "check";
  return {
    fill: palette.fill,
    edge: palette.edge,
    glyph: kind,
    // One character only. Anything longer overflows the seal and stops reading
    // as a badge; it is also the only admin-authored string that reaches the SVG.
    char: kind === "char" ? String(glyphChar || "?").trim().slice(0, 1).toUpperCase() : null,
  };
}

/** Returns an array of problems; empty means valid. */
export function validateBadge({ slug, label, color, glyph, glyphChar, kind }) {
  const problems = [];
  const cleanSlug = String(slug || "").trim().toLowerCase();
  if (!SLUG_RE.test(cleanSlug)) problems.push("Slug must be 3-32 characters, lowercase letters, numbers and dashes.");
  if (RESERVED_SLUGS.has(cleanSlug)) problems.push(`"${cleanSlug}" is a built-in badge name.`);
  if (!String(label || "").trim()) problems.push("A badge needs a label.");
  if (String(label || "").trim().length > 40) problems.push("Label is too long (40 characters).");
  if (!BADGE_COLORS[color]) problems.push("Pick a colour from the palette.");
  if (!BADGE_GLYPHS[glyph]) problems.push("Pick a glyph.");
  if (glyph === "char" && !String(glyphChar || "").trim()) problems.push("A letter or number is needed for that glyph.");
  if (!BADGE_KINDS[kind]) problems.push("Pick a kind.");
  return problems;
}
