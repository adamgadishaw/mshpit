import { normalizeCatalogSearchText } from "../../../src/domain/catalogSearchText.mjs";
import { publicTourDateArtistProjection, publicTourDateBilledArtists, publicTourDateProviderFields } from "../../tourDateMetadata.js";
import { publicTourDateVenueFields } from "../../publicTourDateVenueProjection.js";
import { discoverRowCountryLabel } from "../../../src/domain/discoverScene.mjs";

// These are projection inputs, not additional searchable aliases/evidence.
export const CATALOG_SEARCH_COLUMNS = Object.freeze([
  "artist", "event_name", "tour_name", "billed_artists", "music_evidence",
  "venue", "place", "venue_city", "venue_region", "venue_country", "venue_country_code",
  "owner_id", "artist_identity_status", "source",
]);
export function publicCatalogSearchText(row) {
  const provider = publicTourDateProviderFields(row);
  const venue = publicTourDateVenueFields(row);
  const fields = [
    publicTourDateArtistProjection(row).artist, provider.eventName, provider.tourName,
    ...publicTourDateBilledArtists(row), row.venue, row.place,
    venue.venueCity, venue.venueRegion, discoverRowCountryLabel(venue), venue.venueCountry,
  ];
  return normalizeCatalogSearchText(fields.filter(value => typeof value === "string").join(" "));
}
export function catalogSearchSqliteText(...values) {
  return publicCatalogSearchText(Object.fromEntries(CATALOG_SEARCH_COLUMNS.map((name, index) => [name, values[index]])));
}
export function catalogSearchMatchExpression(query) {
  // FTS syntax is data, too. Quote literal terms; never let a query become an
  // FTS operator. Short terms remain literal instr predicates on stored text.
  return query.split(" ").filter(term => [...term].length >= 3)
    .map(term => '"' + term.replaceAll('"', '""') + '"').join(" AND ");
}
