// Server totals remain exact for accessibility; only the compact visual caps.
export const unreadBadgeCount = value => Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
export const unreadBadgeText = value => {
  const count = unreadBadgeCount(value);
  return count > 99 ? "99+" : String(count);
};
