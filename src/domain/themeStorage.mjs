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
 * @param storage a Storage-like object (getItem/setItem/removeItem). May throw.
 * @returns true only when BOTH keys were written and read back exactly.
 */
export function writeThemePair(storage, { themeKey, ownerKey }, theme, ownerId) {
  if (!storage || typeof storage.setItem !== "function" || typeof storage.getItem !== "function") return false;
  const readPair = () => ({
    theme: storage.getItem(themeKey),
    owner: storage.getItem(ownerKey),
  });
  const samePair = (left, right) => left.theme === right.theme && left.owner === right.owner;
  let previous;
  try {
    previous = readPair();
  } catch {
    return false;
  }
  const owner = ownerId || "guest";
  const attempted = { theme, owner };
  let themeWritten = false;
  let ownerWritten = false;
  try {
    storage.setItem(themeKey, theme);
    themeWritten = true;
    storage.setItem(ownerKey, owner);
    ownerWritten = true;
    if (!samePair(readPair(), attempted)) {
      throw new Error("Theme persistence could not be verified.");
    }
    return true;
  } catch {
    // Only clean up the exact state this attempt can have produced. Another
    // browser tab may have saved a newer valid pair between our write and
    // readback; compare-before-remove keeps that newer choice intact.
    try {
      const expected = ownerWritten
        ? attempted
        : (themeWritten ? { theme, owner: previous.owner } : null);
      if (expected && samePair(readPair(), expected)) {
        storage.removeItem?.(themeKey);
        const afterThemeRemoval = readPair();
        if (afterThemeRemoval.theme == null && afterThemeRemoval.owner === expected.owner) {
          storage.removeItem?.(ownerKey);
        }
      }
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
