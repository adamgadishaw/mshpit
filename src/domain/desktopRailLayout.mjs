export const DESKTOP_RIGHT_RAIL_WIDE_WIDTH = 340;
export const DESKTOP_RIGHT_RAIL_COMPACT_WIDTH = 300;

export function desktopRightRailLayout({
  viewportWidth,
  desktop = true,
  playerColumnWidth = 0,
  minimumCenterWidth = 860,
} = {}) {
  const viewport = Number(viewportWidth);
  const player = Number(playerColumnWidth);
  const minimumCenter = Number(minimumCenterWidth);
  if (!desktop || !Number.isFinite(viewport) || viewport <= 0) {
    return { visible: false, width: 0, availableWidth: 0, centerWidth: 0 };
  }

  const availableWidth = Math.max(0, viewport - (Number.isFinite(player) ? Math.max(0, player) : 0));
  const width = availableWidth >= 1_480
    ? DESKTOP_RIGHT_RAIL_WIDE_WIDTH
    : DESKTOP_RIGHT_RAIL_COMPACT_WIDTH;
  const centerFloor = Number.isFinite(minimumCenter) ? Math.max(620, minimumCenter) : 860;
  const visible = availableWidth >= centerFloor + width;
  return {
    visible,
    width: visible ? width : 0,
    availableWidth,
    centerWidth: visible ? availableWidth - width : availableWidth,
  };
}
