import { canAccessTheme, resolveAccountTheme, resolveTheme } from "../domain/themeAccess.mjs";

// Process-local, never persisted authority. Only the live /api/me bootstrap
// may populate this before static StyleSheets load. No cached role is trusted.
let startupTheme = null;
export const readStartupTheme = () => startupTheme;

export async function prepareThemeStartup({ readSelection, fetchAccount, signedOut }) {
  const selection = readSelection();
  startupTheme = resolveTheme(selection.theme, null);
  if (!selection.theme || canAccessTheme(selection.theme, null) || signedOut()) return;
  try {
    const account = await fetchAccount();
    if (!signedOut()) startupTheme = resolveAccountTheme(account, selection);
  } catch {
    // The API adapter records the failure. Offline startup uses a public theme
    // without deleting a choice that may still belong to a Pit Team account.
  }
}
