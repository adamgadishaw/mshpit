export const PRODUCTION_API_ORIGIN = "https://www.mshpit.com";

const DEV_HOSTS = new Set(["localhost", "127.0.0.1"]);

function safeOrigin(value, { development = false } = {}) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const localDevelopment = development && url.protocol === "http:" && DEV_HOSTS.has(url.hostname);
    if ((!localDevelopment && url.protocol !== "https:")
      || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Keep production credentials on the first-party API even if a public build
 * variable is stale or maliciously shaped. Web production is always
 * same-origin; native release builds accept only the canonical Mshpit origin.
 */
export function apiBaseForRuntime({
  platform,
  configuredOrigin,
  development = false,
  devWeb = false,
} = {}) {
  if (platform === "web") {
    if (devWeb) return "http://localhost:3000";
    return "";
  }
  const configured = safeOrigin(configuredOrigin, { development });
  if (development && configured) return configured;
  return configured === PRODUCTION_API_ORIGIN ? configured : PRODUCTION_API_ORIGIN;
}
