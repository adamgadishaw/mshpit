export const LICENSED_SOURCES = new Set(["licensed", "commons", "openverse"]);
const PROVIDER_SOURCES = new Set(["ticketmaster"]);

const safeAttributionUrl = (value) => {
  if (typeof value !== "string" || !value.trim() || value.length > 2_000) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    return url.toString();
  } catch {
    return null;
  }
};

const licensedMediaAttribution = (media) => {
  const source = String(media?.source || "").trim().toLocaleLowerCase();
  if (!LICENSED_SOURCES.has(source)) return null;
  const creator = typeof media?.by === "string" ? media.by.trim() : "";
  const license = typeof media?.license === "string" ? media.license.trim() : "";
  const sourcePage = safeAttributionUrl(media?.sourcePage);
  const licenseUrl = safeAttributionUrl(media?.licenseUrl);
  return creator && license && sourcePage && licenseUrl ? { creator, license, sourcePage, licenseUrl } : null;
};

const providerMediaAttribution = (media) => {
  const source = String(media?.source || "").trim().toLocaleLowerCase();
  const provider = String(media?.provider || "").trim().toLocaleLowerCase();
  if (source !== "provider" || !PROVIDER_SOURCES.has(provider)) return null;
  const creator = typeof media?.by === "string" ? media.by.trim() : "";
  const sourcePage = safeAttributionUrl(media?.sourcePage);
  return creator && sourcePage ? { creator, sourcePage, provider } : null;
};

export const discoverPhotoAttribution = (media) => licensedMediaAttribution(media) || providerMediaAttribution(media);
