const clean = value => typeof value === "string" ? value.trim().toLocaleLowerCase("en") : "";

// Presentation-only, reviewed provider aliases. Never use name similarity or
// nearby pins to merge rooms, and never rewrite stored events, media or reviews.
// REBEL's Ticketmaster and TicketWeb inventories have two Discovery venue ids
// for the same main room at 11 Polson Street, Toronto, ON M5A 1A4:
// https://www.ticketmaster.ca/rebel-tickets-toronto/venue/131074
// https://www.ticketweb.com/venue/rebel-toronto-on/10320
// https://rebeltoronto.com/info/ (verified 2026-09-16).
// NOIR (inside REBEL) has a different id and is deliberately NOT an alias.
const REBEL_IDS = new Set(["kovzpzadifaa", "rz7hnezae-8"]);

export function venueListingProviderIdentity(row) {
  const source = clean(row?.source);
  const providerId = clean(row?.providerVenueId ?? row?.venue_provider_id);
  if (!source || !providerId) return null;
  const identity = `provider:${source}:${providerId}`;
  if (source !== "ticketmaster" || !REBEL_IDS.has(providerId)) return identity;
  const place = String(row?.place || "").split(",").map(clean).filter(Boolean);
  const name = clean(row?.name || row?.venue);
  const city = clean(row?.venueCity || row?.venue_city || row?.city) || place[0];
  const country = clean(row?.venueCountryCode || row?.venue_country_code || row?.venueCountry || row?.venue_country)
    || (place.length > 1 ? place.at(-1) : "");
  const region = clean(row?.venueRegion || row?.venue_region) || (place.length > 2 ? place.at(-2) : "");
  return name === "rebel" && city === "toronto" && ["ca", "canada"].includes(country)
    && (!region || ["on", "ontario"].includes(region))
    ? "provider:ticketmaster:kovzpzadifaa" : identity;
}
