import { canonicalVenueCountry, isVenuePlaceActionable } from "./venueDiscovery.mjs";

const clean = (value) => String(value || "").replace(/\s+/gu, " ").trim();
const identity = (value) => clean(value)
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/gu, "")
  .toLocaleLowerCase("en");

const placeEdges = (value) => {
  const parts = clean(value).split(",").map((part) => part.trim()).filter(Boolean);
  return {
    full: identity(parts.join(", ")),
    city: identity(parts[0]),
    country: identity(canonicalVenueCountry(parts.length > 1 ? parts.at(-1) : "")),
  };
};

const coordinate = (value, minimum, maximum) => {
  if (value == null || value === "" || typeof value === "boolean") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
};

export function venuePlacesMatch(left, right) {
  const first = placeEdges(left);
  const second = placeEdges(right);
  if (!first.full || !second.full) return false;
  if (first.full === second.full) return true;
  return !!(first.city && first.country && second.city && second.country
    && first.city === second.city && first.country === second.country);
}

export function venueCapacity(value) {
  if (value == null || value === "" || typeof value === "boolean") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function venueCoordinates(value) {
  const lat = coordinate(value?.lat, -90, 90);
  const lng = coordinate(value?.lng, -180, 180);
  return lat == null || lng == null ? null : Object.freeze({ lat, lng });
}

const mapsDirectionsUrl = (destination, travelMode = null) => {
  const mode = travelMode ? `&travelmode=${encodeURIComponent(travelMode)}` : "";
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}${mode}`;
};

const mapsSearchUrl = (query) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;

export function venueGuideModel({ name, place, capacity, coord } = {}) {
  const venueName = clean(name);
  const venuePlace = clean(place);
  const listedCapacity = venueCapacity(capacity);
  const location = venueCoordinates(coord);
  const placeKnown = isVenuePlaceActionable(venuePlace);
  const searchable = !!(venueName && (location || placeKnown));
  const destination = location
    ? `${location.lat},${location.lng}`
    : [venueName, venuePlace].filter(Boolean).join(", ");
  const placeQuery = [venueName, venuePlace].filter(Boolean).join(", ");
  const actions = searchable ? [
    Object.freeze({
      id: "directions",
      icon: "pin",
      label: "Directions",
      description: "Open live directions in Maps.",
      url: mapsDirectionsUrl(destination),
    }),
    Object.freeze({
      id: "parking",
      icon: "map",
      label: "Parking nearby",
      description: "Check current parking options near the venue.",
      url: mapsSearchUrl(`parking near ${placeQuery}`),
    }),
    Object.freeze({
      id: "transit",
      icon: "map",
      label: "Public transit",
      description: "Check current transit routes to the venue.",
      url: mapsDirectionsUrl(destination, "transit"),
    }),
  ] : [];

  return Object.freeze({
    capacity: listedCapacity,
    capacityLabel: listedCapacity == null ? null : listedCapacity.toLocaleString("en"),
    seatingSummary: listedCapacity == null
      ? "Seating and capacity vary by event. Check the event ticket map before you go."
      : `Listed capacity: ${listedCapacity.toLocaleString("en")}. Concert layouts can change by event, so check the event ticket map before you go.`,
    actions: Object.freeze(actions),
  });
}
