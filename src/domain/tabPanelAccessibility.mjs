// Web panels have ARIA tab semantics. Native has no tabpanel accessibilityRole;
// keep each panel's headings and controls separately reachable by screen readers.
export function tabPanelAccessibilityProps(platform, labelledBy) {
  return platform === 'web'
    ? { accessibilityRole: 'tabpanel', 'aria-labelledby': labelledBy }
    : { accessible: false };
}
