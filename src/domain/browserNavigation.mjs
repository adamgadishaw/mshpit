import { isPublicEntityPath, parsePublicCollectionPath } from "./urls.mjs";

export const MAIN_TAB_PATHS = Object.freeze({ feed: "/feed", search: "/search", discover: "/discover", you: "/you" });
export const mainTabForPath = (path) => Object.keys(MAIN_TAB_PATHS).find((tab) => MAIN_TAB_PATHS[tab] === path) || null;

// Preserve server-owned location filters and pagination, never substitute page 1.
export function serverDocumentNavigationPath(pathname) {
  const path = String(pathname || "/").split(/[?#]/)[0];
  const collection = parsePublicCollectionPath(path);
  if (!collection) return null;
  return collection.page > 1 || collection.nonCanonicalPageOne
    || ["concerts", "city-concerts", "city-venues"].includes(collection.type) ? path : null;
}

// Browser history is the durable navigation authority on web. A persisted
// overlay is useful only when there is no meaningful browser destination to
// disagree with it; the home URL and every public entity URL are meaningful.
// Keeping this policy pure makes the reload contract testable without React or
// localStorage.
export function persistedStackPolicy(pathname) {
  const supplied = String(pathname ?? "").trim();
  if (!supplied) return { restore: true, reason: "no-browser-path" };
  const path = supplied.split("?")[0].split("#")[0] || "/";
  if (path === "/") return { restore: false, reason: "home" };
  if (isPublicEntityPath(path)) return { restore: false, reason: "public-entity" };
  return { restore: false, reason: "browser-path" };
}

export const shouldRestorePersistedStack = (pathname) => persistedStackPolicy(pathname).restore;
