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
