// Theme persistence policy, kept pure so it can be tested without importing
// theme.js (which reads storage and applies a theme at import time).
//
// The theme and the account it belongs to are ONE fact stored across TWO keys.
// Writing them independently is what allows a theme to end up unscoped, and an
// unscoped theme is inherited by the next account to use the same browser.
//
// This matters more than it looks because the obvious guard does not work:
// checking that `localStorage` EXISTS says nothing about whether `setItem`
// SUCCEEDS. In Safari private mode the object is present and the write throws.

/**
 * Write the theme/owner pair atomically.
 *
 * @param storage a Storage-like object (setItem/removeItem). May throw.
 * @returns true only when BOTH keys were written.
 */
export function writeThemePair(storage, { themeKey, ownerKey }, theme, ownerId) {
  if (!storage || typeof storage.setItem !== "function") return false;
  try {
    storage.setItem(themeKey, theme);
    storage.setItem(ownerKey, ownerId || "guest");
    return true;
  } catch {
    // Roll back to a consistent state instead of leaving half a pair behind.
    // Falling back to the default theme is recoverable; silently wearing
    // someone else's theme is not.
    try {
      storage.removeItem?.(themeKey);
      storage.removeItem?.(ownerKey);
    } catch { /* storage is fully unavailable; nothing left to undo */ }
    return false;
  }
}

/**
 * Whether a stored theme belongs to the current viewer.
 * A theme saved by another account must not apply to this one.
 */
export function themeBelongsTo(storedOwnerId, viewerId) {
  const stored = storedOwnerId || "guest";
  const viewer = viewerId || "guest";
  return stored === viewer;
}
