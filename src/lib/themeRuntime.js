// Browser behavior stays localStorage + verified theme/owner pair + reload.
import { writeThemePair } from "../domain/themeStorage.mjs";
const keys = { themeKey: "pit_theme", ownerKey: "pit_theme_owner" };
export const nativeThemeRuntime = false;
export function readThemeSelection() {
  try {
    if (typeof window === "undefined" || !window.localStorage) return { theme: null, ownerId: null };
    return { theme: window.localStorage.getItem(keys.themeKey), ownerId: window.localStorage.getItem(keys.ownerKey) };
  } catch { return { theme: null, ownerId: null }; }
}
export function persistThemeSelection(theme, ownerId) {
  if (typeof window === "undefined") return false;
  return writeThemePair(window.localStorage, keys, theme, ownerId);
}
export function clearThemeSelection() {
  if (typeof window !== "undefined" && window.localStorage) {
    window.localStorage.removeItem(keys.themeKey);
    window.localStorage.removeItem(keys.ownerKey);
  }
}
export function reloadTheme() { window.location.reload(); }
