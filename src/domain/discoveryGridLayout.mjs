// Measure the section itself rather than assuming the viewport is all content
// (desktop sidebars and panel padding both reduce the usable width).
export function discoveryGridLayout(containerWidth) {
  const numericWidth = Number(containerWidth);
  const width = Number.isFinite(numericWidth) ? Math.max(1, numericWidth) : 1;
  const gap = 12;
  const columns = Math.max(1, Math.min(3, Math.floor((width + gap) / (236 + gap))));
  return { columns, gap, tileWidth: Math.floor((width - gap * (columns - 1)) / columns) };
}
