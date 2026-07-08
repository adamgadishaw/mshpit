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

const PRESETS = {
  stage: { name: "Stage", sub: "Tungsten amber, dark", dark: true, colors: STAGE },
  daylight: { name: "Daylight", sub: "Warm paper, light", dark: false, colors: DAYLIGHT },
  neon: { name: "Neon", sub: "Synthwave violet", dark: true, colors: NEON },
  forest: { name: "Forest", sub: "Emerald & gold", dark: true, colors: FOREST },
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

export const mono = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });
// Rounder geometry reads modern — cards at 16, sheets/heroes at 24.
export const radius = { sm: 10, md: 16, lg: 24, pill: 999 };
export const space = (n) => n * 4;

// Elevation. Real dark-mode apps lift surfaces with soft shadows instead of
// outlining everything with 1px borders (which reads as "wireframe"). Use these
// on cards/sheets so depth — not a hard border — separates content from the page.
export const shadow = {
  card: Platform.OS === "web"
    ? { boxShadow: "0 1px 2px rgba(0,0,0,0.30), 0 6px 20px rgba(0,0,0,0.22)" }
    : { shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  sheet: Platform.OS === "web"
    ? { boxShadow: "0 10px 44px rgba(0,0,0,0.5)" }
    : { shadowColor: "#000", shadowOpacity: 0.5, shadowRadius: 22, shadowOffset: { width: 0, height: 10 }, elevation: 12 },
};
