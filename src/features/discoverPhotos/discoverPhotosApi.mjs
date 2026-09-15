import { discoverCountryIdentity } from "../../domain/discoverScene.mjs";
import { discoverPhotoCity } from "../../domain/discoverPhotoLocation.mjs";

export function discoverPhotosScope({ accountId = null, region = "Worldwide", city = "" } = {}) {
  return JSON.stringify([accountId || "guest", discoverCountryIdentity(region) || "worldwide", discoverPhotoCity(city)]);
}

export async function fetchDiscoverPhotos({ apiClient, region = "Worldwide", city = "", signal } = {}) {
  const params = new URLSearchParams({ limit: "30" });
  const country = discoverCountryIdentity(region);
  if (country && country !== "worldwide") params.set("country", country);
  if (city.trim()) params.set("city", city.trim().slice(0, 120));
  const result = await apiClient(`/api/discover/photos?${params}`, {
    signal, timeoutMs: 12_000, silent: true, context: "Loading concert photos", cache: "no-store",
  });
  if (!Array.isArray(result?.photos)) throw new Error("Concert photo results could not be read.");
  return result.photos.slice(0, 30).filter((photo) => photo && photo.photosPublic === true
    && typeof photo.uri === "string" && /^https:\/\//i.test(photo.uri)
    && (photo.kind === "image" || photo.kind === "video"));
}

export function visibleDiscoverPhotos(photos, { removedIds = [], blockedIds = [] } = {}) {
  const removed = new Set(removedIds);
  const blocked = new Set(blockedIds);
  return photos.filter((photo) => !removed.has(photo.postId || photo.logId) && !blocked.has(photo.ownerId));
}

export function discoverPhotosPresentation(state, scopeKey) {
  if (state?.scopeKey !== scopeKey) return { photos: [], status: "loading", error: false };
  return { photos: state.photos || [], status: state.status, error: state.status === "error" };
}
