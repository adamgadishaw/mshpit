const text = (value, maximum) => typeof value === "string"
  ? value.replace(/[\u0000-\u001f\u007f]/gu, "").replace(/\s+/gu, " ").trim().slice(0, maximum)
  : "";

// Provider venue ids are meaningful only inside their provider namespace.
// The public projection therefore carries the id only when its source is also
// present, then keeps structured city/country fields beside the display place.
export function publicTourDateVenueFields(row) {
  const source = text(row?.source, 40);
  const providerVenueId = text(row?.venue_provider_id, 180);
  return Object.freeze({
    providerVenueId: source && providerVenueId ? providerVenueId : null,
    venueCity: text(row?.venue_city, 120) || null,
    venueRegion: text(row?.venue_region, 120) || null,
    venueCountryCode: text(row?.venue_country_code, 8).toLocaleUpperCase("en") || null,
    venueCountry: text(row?.venue_country, 80) || null,
  });
}
