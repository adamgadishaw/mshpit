import { serverDocumentNavigationPath } from "./browserNavigation.mjs";

/**
 * Some public collection URLs have complete server-rendered pagination but no
 * equivalent client screen yet. Keep that honest document, including its links
 * and browser history, instead of replacing it with an unrelated app screen.
 * Only the exact server marker is authoritative; a bare Expo/dev shell still
 * mounts normally and is never left as an empty page.
 */
export function shouldPreservePublicDocument(documentObject, pathname) {
  if (!serverDocumentNavigationPath(pathname)) return false;
  const root = documentObject?.getElementById?.("root");
  return !!root?.querySelector?.(":scope > .seo-document");
}

/**
 * Remove the crawler-readable document immediately before Expo mounts.
 *
 * The server deliberately injects this document for search engines and
 * no-JavaScript visitors. React Native Web does not hydrate that markup, so
 * leaving it in #root can keep a second landing page and its CSS alive behind
 * the interactive app. Restrict removal to the exact server marker: ordinary
 * client roots and no-JavaScript visits remain untouched.
 */
export function clearInjectedPublicDocument(documentObject) {
  const root = documentObject?.getElementById?.("root");
  if (!root?.querySelector?.(":scope > .seo-document")) return false;
  root.replaceChildren();
  return true;
}
