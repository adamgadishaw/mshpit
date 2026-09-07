// Project only image fields. Source/license links and editable admin values stay intact.
export function projectCityMedia(payload, resolvePath) {
  if (!payload || typeof payload !== "object") return payload;
  const imageUrl = (value) => typeof value === "string" && /^\/(?:images|assets|media)\//.test(value) ? resolvePath(value) : value;
  const photo = (value) => value && typeof value === "object" ? { ...value, url: imageUrl(value.url) } : value;
  const rows = (value) => Array.isArray(value) ? value.map((row) => ({ ...row, image: imageUrl(row.image), photo: photo(row.photo) })) : value;
  return { ...payload,
    ...(payload.copy ? { copy: { ...payload.copy, welcomeBannerUrl: imageUrl(payload.copy.welcomeBannerUrl) } } : {}),
    ...(payload.editorial ? { editorial: { ...payload.editorial, stockImage: photo(payload.editorial.stockImage) } } : {}),
    ...(Array.isArray(payload.photos) ? { photos: payload.photos.map(photo) } : {}),
    ...Object.fromEntries(["cities", "venues", "artists", "performingArtists", "today", "upcoming"].filter((key) => Array.isArray(payload[key])).map((key) => [key, rows(payload[key])])),
  };
}
