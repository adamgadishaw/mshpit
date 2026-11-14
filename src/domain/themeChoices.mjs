import { canAccessTheme, PRIMARY_THEME_KEYS } from "./themeAccess.mjs";
export { PRIMARY_THEME_KEYS } from "./themeAccess.mjs";

export function visibleThemeChoices(themes, { expanded = false, selectedKey = null, account = null } = {}) {
  const available = Array.isArray(themes)
    ? themes.filter((theme) => theme && canAccessTheme(theme.key, account))
    : [];

  if (expanded) return available;

  const primaryKeys = new Set(PRIMARY_THEME_KEYS);
  return available.filter((theme) => primaryKeys.has(theme.key) || theme.key === selectedKey);
}
