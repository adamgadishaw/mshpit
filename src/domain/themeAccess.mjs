import { isStaff } from "./staffRoles.mjs";

export const THEME_KEYS = Object.freeze(["stage", "neon", "forest", "ember", "daylight", "ice", "rose", "mint", "backstage", "vinyl", "sunset", "lavender"]);
export const PRIMARY_THEME_KEYS = Object.freeze(["stage", "daylight"]);
export const isThemeKey = (key) => typeof key === "string" && THEME_KEYS.includes(key);
export const canAccessTheme = (key, account) => isThemeKey(key)
  && (PRIMARY_THEME_KEYS.includes(key) || (!!account?.id && isStaff(account.role)));

export function resolveTheme(key, account) {
  const normalized = key === "light" ? "daylight" : key === "dark" ? "stage" : key;
  return canAccessTheme(normalized, account) ? normalized : "stage";
}

// Local preference only wins for its owner AND while that owner may use it.
// A restricted legacy choice remains stored, dormant, until an explicit choice.
export function resolveAccountTheme(account, selection = {}) {
  const ownerId = account?.id || "guest";
  if (selection.ownerId === ownerId && canAccessTheme(selection.theme, account)) return selection.theme;
  return resolveTheme(account?.theme, account);
}
