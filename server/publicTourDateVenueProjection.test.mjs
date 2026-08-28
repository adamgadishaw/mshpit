import assert from "node:assert/strict";
import test from "node:test";

import { publicTourDateVenueFields } from "./publicTourDateVenueProjection.js";

test("tour-date venue projection preserves provider namespace and structured location", () => {
  assert.deepEqual(publicTourDateVenueFields({
    source: "ticketmaster",
    venue_provider_id: " venue-7 ",
    venue_city: " Toronto ",
    venue_region: "Ontario",
    venue_country_code: "ca",
    venue_country: "Canada",
  }), {
    providerVenueId: "venue-7",
    venueCity: "Toronto",
    venueRegion: "Ontario",
    venueCountryCode: "CA",
    venueCountry: "Canada",
  });
});

test("an unnamespaced venue id fails closed while safe location fields remain", () => {
  assert.deepEqual(publicTourDateVenueFields({
    source: "",
    venue_provider_id: "ambiguous-id",
    venue_city: "London",
    venue_country_code: "gb",
  }), {
    providerVenueId: null,
    venueCity: "London",
    venueRegion: null,
    venueCountryCode: "GB",
    venueCountry: null,
  });
});
