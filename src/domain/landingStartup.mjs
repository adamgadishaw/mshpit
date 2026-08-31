import { isPublicEntityPath } from "./urls.mjs";

const safeRead = (readPersisted, key, fallback) => {
  if (typeof readPersisted !== "function") return fallback;
  try {
    const value = readPersisted(key, fallback);
    return value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
};

const normalizedPathname = (pathname) => {
  const supplied = String(pathname ?? "").trim();
  return supplied.split("?")[0].split("#")[0] || "/";
};

export function initialLandingState({
  web = false,
  pathname = "",
  demoEnabled = false,
  readPersisted,
} = {}) {
  if (web) {
    const path = normalizedPathname(pathname);
    // The canonical marketing URL is an explicit destination. A previous guest
    // Explore choice is visit-local and must never silently replace `/` after a
    // reload, including when browser storage is unavailable or stale.
    if (path === "/") return true;
    // Shared public destinations hydrate inside the app for guests and members.
    if (path === "/artists" || path === "/events" || isPublicEntityPath(path)) return false;
  }

  const entered = !!safeRead(readPersisted, "pit.entered", false);
  const demoSession = demoEnabled ? safeRead(readPersisted, "pit.session", null) : null;
  return !entered && !demoSession;
}

export function landingRenderSurface({ authReady = false, session = null, landing = true } = {}) {
  if (!authReady) return "pending";
  if (session) return "app";
  return landing ? "landing" : "app";
}
