// Keep Android/web geometry unchanged; iOS tracks live Dynamic Type changes.
export function calendarAccessibilityLayout(platform, viewportWidth, fontScale, horizontalPadding) {
  const scale = Number.isFinite(fontScale) ? Math.max(1, fontScale) : 1;
  const largeText = platform === "ios" && scale > 1.15;
  const dayMinHeight = largeText ? Math.ceil(44 * scale) : 44;
  return {
    largeText,
    dayMinHeight,
    // The existing horizontal scroller keeps all seven columns reachable when
    // accessibility text requires more space than a compact phone can provide.
    width: Math.max(largeText ? dayMinHeight * 7 : 308, Math.min(560, viewportWidth - horizontalPadding)),
  };
}
