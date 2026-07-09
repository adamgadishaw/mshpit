import { Platform } from "react-native";

// Pit - "stage-light" design system. Four on-brand presets the user can switch
// between in Settings. Every screen imports `colors` (resolved once at module
// load), so switching a theme saves the choice and reloads - the least invasive
// way to re-theme a StyleSheet-based app.

const STAGE = {
  bg: "#07090F", bgElev: "#0C1018", surface: "#10151F", surfaceAlt: "#1A2030",
  line: "#232B42", lineSoft: "#1A202F", text: "#F4EFE7", textDim: "#9AA0B6", textFaint: "#646B82",
  amber: "#F2A65A", amberStrong: "#FF8C42", gold: "#E8B65A", magenta: "#E0457B", cool: "#5B8DEF", good: "#6FCF97", danger: "#E0457B",
};

const DAYLIGHT = {
  bg: "#FBF7F0", bgElev: "#FFFFFF", surface: "#FFFFFF", surfaceAlt: "#F3ECE1",
  line: "#E4DACB", lineSoft: "#EFE8DC", text: "#1C140C", textDim: "#6E6355", textFaint: "#9C8F7C",
  amber: "#C96A1C", amberStrong: "#E47A24", gold: "#B5862A", magenta: "#C8356B", cool: "#3D6FD6", good: "#2E9E5B", danger: "#C8356B",
};

// Synthwave: deep indigo with violet + magenta gels.
const NEON = {
  bg: "#0C0A1A", bgElev: "#131029", surface: "#1B1636", surfaceAlt: "#251D48",
  line: "#362B63", lineSoft: "#2A2150", text: "#F1ECFF", textDim: "#ADA2D6", textFaint: "#726699",
  amber: "#C084FC", amberStrong: "#A855F7", gold: "#F0ABFC", magenta: "#F472B6", cool: "#38BDF8", good: "#34D399", danger: "#FB7185",
};

// Forest: near-black green with emerald + gold.
const FOREST = {
  bg: "#08120D", bgElev: "#0D1A13", surface: "#12241A", surfaceAlt: "#1A3025",
  line: "#274A38", lineSoft: "#1F3A2C", text: "#E9F5EC", textDim: "#90AE9C", textFaint: "#5E7A69",
  amber: "#34D399", amberStrong: "#10B981", gold: "#FBBF24", magenta: "#F472B6", cool: "#38BDF8", good: "#34D399", danger: "#FB7185",
};

// Ember: warm charcoal dark with a coral/pink primary + violet gel — a hot dark.
const EMBER = {
  bg: "#150E11", bgElev: "#1D1318", surface: "#251820", surfaceAlt: "#33232C",
  line: "#412C38", lineSoft: "#2D1E28", text: "#FCEEE9", textDim: "#CBA69F", textFaint: "#8C6A64",
  amber: "#FF8A73", amberStrong: "#FF6B5E", gold: "#F4B45C", magenta: "#C86BFF", cool: "#5BD0EF", good: "#5FD08A", danger: "#FF5E7E",
};

// Ice: cool near-white LIGHT theme led by blue (not warm amber) — a real
// alternative to Daylight, not a near-twin.
const ICE = {
  bg: "#F1F6FC", bgElev: "#FFFFFF", surface: "#FFFFFF", surfaceAlt: "#E6EEF8",
  line: "#D2DEEE", lineSoft: "#E2EAF5", text: "#0F1B2A", textDim: "#566880", textFaint: "#8FA0B6",
  amber: "#2E86DE", amberStrong: "#1B6FD1", gold: "#B5862A", magenta: "#7B5CF0", cool: "#0FA9C4", good: "#159E6B", danger: "#E0457B",
};

// Rose: soft blush LIGHT theme led by rose-pink + gold stars.
const ROSE = {
  bg: "#FDF3F6", bgElev: "#FFFFFF", surface: "#FFFFFF", surfaceAlt: "#F8E6EC",
  line: "#EFD2DC", lineSoft: "#F4E1E8", text: "#2A1420", textDim: "#7A5563", textFaint: "#B1899C",
  amber: "#E04E86", amberStrong: "#D53A78", gold: "#C79A2E", magenta: "#9B5CF0", cool: "#4A8FE0", good: "#2E9E5B", danger: "#D53A78",
};

// Mint: pale green LIGHT theme led by emerald + a coral gel.
const MINT = {
  bg: "#EFFAF4", bgElev: "#FFFFFF", surface: "#FFFFFF", surfaceAlt: "#E0F2E9",
  line: "#CCE7D8", lineSoft: "#DDF0E6", text: "#0E241A", textDim: "#4E7060", textFaint: "#8DB0A0",
  amber: "#14A06A", amberStrong: "#0E9160", gold: "#C08A2E", magenta: "#C05CE0", cool: "#2E9ED6", good: "#0E9160", danger: "#E0457B",
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

// Read the saved theme synchronously at load (web localStorage). Back-compat: the
// old key stored "dark"/"light" - map those onto the new preset keys.
let key = "stage";
try {
  if (typeof window !== "undefined" && window.localStorage) {
    const saved = window.localStorage.getItem("pit_theme");
    if (saved === "light") key = "daylight";
    else if (saved === "dark") key = "stage";
    else if (saved && PRESETS[saved]) key = saved;
  }
} catch {}

export const themeKey = key;
export const colors = (PRESETS[key] || PRESETS.stage).colors;

// Swatch metadata for the theme picker.
export const THEMES = Object.entries(PRESETS).map(([k, v]) => ({
  key: k, name: v.name, sub: v.sub, dark: v.dark,
  swatch: { bg: v.colors.bg, surface: v.colors.surface, accent: v.colors.amberStrong, accent2: v.colors.magenta, text: v.colors.text },
}));

export function setTheme(next) {
  if (!PRESETS[next]) return;
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem("pit_theme", next);
      window.location.reload();
    }
  } catch {}
}

// Apply a theme that came from the signed-in account (login / a new device).
// No-op when it already matches what's rendered, so it never loops on the
// reload it triggers: after the reload themeKey === next and this returns early.
export function syncThemeFromAccount(next) {
  if (!next || !PRESETS[next] || next === key) return;
  setTheme(next);
}

// Official positions get a colored @handle so they're unmistakable (Discord-
// style): admins in the magenta gel, moderators in green, verified artists in the
// tungsten amber. Everyone else uses the default text color.
export const roleColor = (role) =>
  role === "admin" ? colors.magenta : role === "moderator" ? colors.good : role === "artist" ? colors.amber : null;

export const mono = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });
// Rounder geometry reads modern — cards at 16, sheets/heroes at 24.
export const radius = { sm: 10, md: 16, lg: 24, pill: 999 };
export const space = (n) => n * 4;

// Elevation. Real apps lift surfaces with soft shadows instead of outlining
// everything with a 1px border (which reads as "wireframe"). A plain black drop
// shadow vanishes on a near-black page, so DARK themes get a deeper, larger shadow
// to actually read as depth; LIGHT themes get a soft, subtle one.
const _dark = (PRESETS[key] || PRESETS.stage).dark;
export const shadow = {
  card: Platform.OS === "web"
    ? { boxShadow: _dark ? "0 2px 4px rgba(0,0,0,0.45), 0 10px 30px rgba(0,0,0,0.5)" : "0 1px 2px rgba(16,24,40,0.10), 0 6px 20px rgba(16,24,40,0.10)" }
    : { shadowColor: "#000", shadowOpacity: _dark ? 0.5 : 0.14, shadowRadius: _dark ? 14 : 10, shadowOffset: { width: 0, height: 5 }, elevation: 3 },
  sheet: Platform.OS === "web"
    ? { boxShadow: _dark ? "0 14px 50px rgba(0,0,0,0.65)" : "0 12px 40px rgba(16,24,40,0.18)" }
    : { shadowColor: "#000", shadowOpacity: _dark ? 0.6 : 0.2, shadowRadius: 22, shadowOffset: { width: 0, height: 10 }, elevation: 12 },
};
