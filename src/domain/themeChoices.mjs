export const PRIMARY_THEME_KEYS = Object.freeze(["stage", "daylight"]);

export function visibleThemeChoices(themes, { expanded = false, selectedKey = null } = {}) {
  const available = Array.isArray(themes)
    ? themes.filter((theme) => theme && typeof theme.key === "string")
    : [];

  if (expanded) return available;

  const primaryKeys = new Set(PRIMARY_THEME_KEYS);
  return available.filter((theme) => primaryKeys.has(theme.key) || theme.key === selectedKey);
}
