import { Platform } from "react-native";

// Pit - "stage-light" design system. On-brand presets the user can switch
// between in Settings. Every screen imports `colors` (resolved once at module
// load), so switching a theme saves the choice and reloads - the least invasive
// way to re-theme a StyleSheet-based app.

const STAGE = {
  bg: "#07090F", bgElev: "#0C1018", surface: "#10151F", surfaceAlt: "#1A2030",
  line: "#232B42", lineSoft: "#1A202F", text: "#F4EFE7", textDim: "#9AA0B6", textFaint: "#646B82",
  amber: "#F2A65A", amberStrong: "#FF8C42", accentEdge: "#A94F1F", gold: "#E8B65A", magenta: "#E0457B", cool: "#5B8DEF", good: "#6FCF97", danger: "#E0457B",
};

const DAYLIGHT = {
  bg: "#FBF7F0", bgElev: "#FFFFFF", surface: "#FFFFFF", surfaceAlt: "#F3ECE1",
  line: "#E4DACB", lineSoft: "#EFE8DC", text: "#1C140C", textDim: "#6E6355", textFaint: "#9C8F7C",
  amber: "#C96A1C", amberStrong: "#E47A24", accentEdge: "#9B4710", gold: "#B5862A", magenta: "#C8356B", cool: "#3D6FD6", good: "#2E9E5B", danger: "#C8356B",
};

// Synthwave: deep indigo with violet + magenta gels.
const NEON = {
  bg: "#0C0A1A", bgElev: "#131029", surface: "#1B1636", surfaceAlt: "#251D48",
  line: "#362B63", lineSoft: "#2A2150", text: "#F1ECFF", textDim: "#ADA2D6", textFaint: "#726699",
  amber: "#C084FC", amberStrong: "#A855F7", accentEdge: "#6824A8", gold: "#F0ABFC", magenta: "#F472B6", cool: "#38BDF8", good: "#34D399", danger: "#FB7185",
};

// Forest: near-black green with emerald + gold.
const FOREST = {
  bg: "#08120D", bgElev: "#0D1A13", surface: "#12241A", surfaceAlt: "#1A3025",
  line: "#274A38", lineSoft: "#1F3A2C", text: "#E9F5EC", textDim: "#90AE9C", textFaint: "#5E7A69",
  amber: "#34D399", amberStrong: "#10B981", accentEdge: "#087557", gold: "#FBBF24", magenta: "#F472B6", cool: "#38BDF8", good: "#34D399", danger: "#FB7185",
};

// Ember: warm charcoal dark with a coral/pink primary + violet gel, a hot dark.
const EMBER = {
  bg: "#150E11", bgElev: "#1D1318", surface: "#251820", surfaceAlt: "#33232C",
  line: "#412C38", lineSoft: "#2D1E28", text: "#FCEEE9", textDim: "#CBA69F", textFaint: "#8C6A64",
  amber: "#FF8A73", amberStrong: "#FF6B5E", accentEdge: "#B63E38", gold: "#F4B45C", magenta: "#C86BFF", cool: "#5BD0EF", good: "#5FD08A", danger: "#FF5E7E",
};

// Ice: cool near-white LIGHT theme led by blue (not warm amber), a real
// alternative to Daylight, not a near-twin.
const ICE = {
  bg: "#F1F6FC", bgElev: "#FFFFFF", surface: "#FFFFFF", surfaceAlt: "#E6EEF8",
  line: "#D2DEEE", lineSoft: "#E2EAF5", text: "#0F1B2A", textDim: "#566880", textFaint: "#8FA0B6",
  amber: "#2E86DE", amberStrong: "#1B6FD1", accentEdge: "#114B91", gold: "#B5862A", magenta: "#7B5CF0", cool: "#0FA9C4", good: "#159E6B", danger: "#E0457B",
};

// Rose: soft blush LIGHT theme led by rose-pink + gold stars.
const ROSE = {
  bg: "#FDF3F6", bgElev: "#FFFFFF", surface: "#FFFFFF", surfaceAlt: "#F8E6EC",
  line: "#EFD2DC", lineSoft: "#F4E1E8", text: "#2A1420", textDim: "#7A5563", textFaint: "#B1899C",
  amber: "#E04E86", amberStrong: "#D53A78", accentEdge: "#9A2453", gold: "#C79A2E", magenta: "#9B5CF0", cool: "#4A8FE0", good: "#2E9E5B", danger: "#D53A78",
};

// Mint: pale green LIGHT theme led by emerald + a coral gel.
const MINT = {
  bg: "#EFFAF4", bgElev: "#FFFFFF", surface: "#FFFFFF", surfaceAlt: "#E0F2E9",
  line: "#CCE7D8", lineSoft: "#DDF0E6", text: "#0E241A", textDim: "#4E7060", textFaint: "#8DB0A0",
  amber: "#14A06A", amberStrong: "#0E9160", accentEdge: "#075D3E", gold: "#C08A2E", magenta: "#C05CE0", cool: "#2E9ED6", good: "#0E9160", danger: "#E0457B",
};

// Backstage: cool production-blue, inspired by flight cases, lanyards, and the
// light leaking out from behind a stage curtain.
const BACKSTAGE = {
  bg: "#071018", bgElev: "#0D1824", surface: "#132234", surfaceAlt: "#1B3046",
  line: "#294761", lineSoft: "#1E354A", text: "#F3F8FC", textDim: "#A2B7C7", textFaint: "#668096",
  amber: "#49C6E5", amberStrong: "#22B5D6", accentEdge: "#0B7189", gold: "#F6C85F", magenta: "#FF6B8A", cool: "#7B8CFF", good: "#48D597", danger: "#FF6B7D",
};

// Vinyl: near-black wax, warm sleeve paper, and a restrained red label.
const VINYL = {
  bg: "#0B0A09", bgElev: "#12100E", surface: "#1B1815", surfaceAlt: "#29241F",
  line: "#3D352E", lineSoft: "#2D2823", text: "#FFF8E8", textDim: "#C8BBA5", textFaint: "#847769",
  amber: "#F6C453", amberStrong: "#E9A820", accentEdge: "#9A6512", gold: "#FFD76A", magenta: "#E84A5F", cool: "#63A4FF", good: "#63CE8B", danger: "#F45B69",
};

// Sunset: a bright festival-poster palette that stays readable in daylight.
const SUNSET = {
  bg: "#FFF4EA", bgElev: "#FFFDFB", surface: "#FFFFFF", surfaceAlt: "#FCE4D5",
  line: "#EBCDBB", lineSoft: "#F4DED0", text: "#321B17", textDim: "#795A50", textFaint: "#AA8577",
  amber: "#F06C4E", amberStrong: "#E8543F", accentEdge: "#A63527", gold: "#C98A22", magenta: "#A94FD8", cool: "#4979D1", good: "#25865A", danger: "#C83C54",
};

// Lavender: soft album-art pastels with a strong indigo control color.
const LAVENDER = {
  bg: "#F5F1FF", bgElev: "#FFFFFF", surface: "#FFFFFF", surfaceAlt: "#E9E1F8",
  line: "#D8CDEE", lineSoft: "#E7DFF4", text: "#21152F", textDim: "#665779", textFaint: "#9687AA",
  amber: "#7657D6", amberStrong: "#6845CF", accentEdge: "#3E258F", gold: "#AE7B17", magenta: "#D14F93", cool: "#3389C8", good: "#1F8A63", danger: "#CF4265",
};

const PRESETS = {
  stage: { name: "Stage", sub: "Tungsten amber · dark", dark: true, colors: STAGE },
  neon: { name: "Neon", sub: "Synthwave violet · dark", dark: true, colors: NEON },
  forest: { name: "Forest", sub: "Emerald & gold · dark", dark: true, colors: FOREST },
  ember: { name: "Ember", sub: "Coral heat · dark", dark: true, colors: EMBER },
  daylight: { name: "Daylight", sub: "Warm paper · light", dark: false, colors: DAYLIGHT },
  ice: { name: "Ice", sub: "Cool blue · light", dark: false, colors: ICE },
  rose: { name: "Rose", sub: "Soft blush · light", dark: false, colors: ROSE },
  mint: { name: "Mint", sub: "Fresh emerald · light", dark: false, colors: MINT },
};

Object.assign(PRESETS, {
  backstage: { name: "Backstage", sub: "Production blue / dark", dark: true, colors: BACKSTAGE },
  vinyl: { name: "Vinyl", sub: "Black wax & gold / dark", dark: true, colors: VINYL },
  sunset: { name: "Sunset", sub: "Festival coral / light", dark: false, colors: SUNSET },
  lavender: { name: "Lavender", sub: "Album pastel / light", dark: false, colors: LAVENDER },
});

const THEME_STORAGE_KEY = "pit_theme";
const THEME_OWNER_KEY = "pit_theme_owner";

// Read the saved theme synchronously at load (web localStorage). Back-compat: the
// old key stored "dark"/"light" - map those onto the new preset keys.
let key = "stage";
try {
  if (typeof window !== "undefined" && window.localStorage) {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "light") key = "daylight";
    else if (saved === "dark") key = "stage";
    else if (saved && PRESETS[saved]) key = saved;
  }
} catch {}

export const themeKey = key;
const activeTheme = PRESETS[key] || PRESETS.stage;
export const colors = activeTheme.colors;
export const themeIsDark = activeTheme.dark;

// Swatch metadata for the theme picker.
//
// Four accents, not two. A preset carries a full accent set (warm, pink, cool,
// gold) but the picker only ever showed the first two, so themes that differ
// mainly in their cool and gold tones looked nearly identical on the chip.
// `accents` is the ordered palette every picker renders; the individual keys
// stay for callers that want one specific colour (the active border, a check).
export const THEMES = Object.entries(PRESETS).map(([k, v]) => ({
  key: k, name: v.name, sub: v.sub, dark: v.dark,
  swatch: {
    bg: v.colors.bg,
    surface: v.colors.surface,
    accent: v.colors.amberStrong,
    accent2: v.colors.magenta,
    accent3: v.colors.cool,
    accent4: v.colors.gold,
    accents: [v.colors.amberStrong, v.colors.magenta, v.colors.cool, v.colors.gold],
    text: v.colors.text,
  },
}));

function persistTheme(next, ownerId = null) {
  if (!PRESETS[next]) return false;
  if (typeof window === "undefined" || !window.localStorage) return false;
  window.localStorage.setItem(THEME_STORAGE_KEY, next);
  window.localStorage.setItem(THEME_OWNER_KEY, ownerId || "guest");
  return true;
}

export function storedThemeSelection() {
  try {
    if (typeof window === "undefined" || !window.localStorage) return { theme: null, ownerId: null };
    return {
      theme: window.localStorage.getItem(THEME_STORAGE_KEY),
      ownerId: window.localStorage.getItem(THEME_OWNER_KEY),
    };
  } catch { return { theme: null, ownerId: null }; }
}

export function clearStoredTheme() {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
      window.localStorage.removeItem(THEME_OWNER_KEY);
    }
  } catch {}
}

export function setTheme(next, ownerId = null) {
  if (!PRESETS[next]) return;
  try { if (persistTheme(next, ownerId)) window.location.reload(); } catch {}
}

// Apply a theme that came from the signed-in account (login / a new device).
// No-op when it already matches what's rendered, so it never loops on the
// reload it triggers: after the reload themeKey === next and this returns early.
export function syncThemeFromAccount(next, ownerId) {
  if (!next || !PRESETS[next]) return;
  try { persistTheme(next, ownerId); } catch {}
  if (next !== key) {
    try { if (typeof window !== "undefined") window.location.reload(); } catch {}
  }
}

// Official positions get a colored @handle so they're unmistakable (Discord-
// style): admins in the magenta gel, moderators in green, verified artists in the
// tungsten amber. Everyone else uses the default text color.
export const roleColor = (role) =>
  role === "admin" ? colors.magenta : role === "moderator" ? colors.good : role === "artist" ? colors.amber : null;

// System-first stacks keep the app crisp without adding a font download to the
// startup path. The rounded display stack gives labels and headings personality;
// body copy stays neutral and highly readable.
export const font = Platform.select({
  ios: "System",
  android: "sans-serif",
  default: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
});
export const displayFont = Platform.select({
  ios: "Avenir Next",
  android: "sans-serif-medium",
  default: 'ui-rounded, "SF Pro Rounded", "Avenir Next", "Arial Rounded MT Bold", "Trebuchet MS", "Segoe UI", sans-serif',
});
export const mono = Platform.select({ ios: "Menlo", android: "monospace", default: '"SFMono-Regular", Consolas, monospace' });

// A small radius scale keeps controls related while continuous curves make
// cards feel less boxy. The two-pixel lift is deliberately subtle site-wide.
export const radius = { sm: 12, md: 18, lg: 26, pill: 999 };
export const space = (n) => n * 4;

// Elevation. Real apps lift surfaces with soft shadows instead of outlining
// everything with a 1px border (which reads as "wireframe"). A plain black drop
// shadow vanishes on a near-black page, so DARK themes get a deeper, larger shadow
// to actually read as depth; LIGHT themes get a soft, subtle one.
const _dark = (PRESETS[key] || PRESETS.stage).dark;
export const shadow = {
  card: {
    boxShadow: _dark
      ? "inset 0 1px 0 rgba(255,255,255,0.035), 0 2px 4px rgba(0,0,0,0.36), 0 12px 28px rgba(0,0,0,0.38)"
      : "inset 0 1px 0 rgba(255,255,255,0.82), 0 2px 4px rgba(16,24,40,0.07), 0 10px 24px rgba(16,24,40,0.09)",
  },
  control: {
    boxShadow: _dark
      ? "inset 0 1px 0 rgba(255,255,255,0.08), 0 4px 10px rgba(0,0,0,0.28)"
      : "inset 0 1px 0 rgba(255,255,255,0.68), 0 3px 8px rgba(16,24,40,0.12)",
  },
  sheet: {
    boxShadow: _dark ? "0 16px 52px rgba(0,0,0,0.62)" : "0 14px 44px rgba(16,24,40,0.17)",
  },
};

// Web gets a visible keyboard-focus halo; native platforms keep their standard
// accessibility focus treatment. Components can spread this into focused state.
export const focusRing = Platform.select({
  web: { outlineColor: colors.amber, outlineOffset: 2, outlineStyle: "solid", outlineWidth: 3 },
  default: {},
});
