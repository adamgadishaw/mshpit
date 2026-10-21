export async function loadVenueMapCatalogueAsset({ signal, request = fetch } = {}) {
  const response = await request("/mshpit-maplibre/venue-catalogue.json", { signal, credentials: "omit" });
  if (!response.ok) throw new Error("venue-catalogue-unavailable");
  const value = await response.json();
  if (!Array.isArray(value?.venues)) throw new Error("venue-catalogue-invalid");
  return value;
}
