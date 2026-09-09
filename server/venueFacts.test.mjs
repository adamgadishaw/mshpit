import assert from "node:assert/strict";
import test from "node:test";

import { hasSubstantiveVenueGuide, publicVenueFacts, publicVenuePlace } from "./venueFacts.js";

test("evergreen venue eligibility requires verified location and concrete visitor facts", () => {
  const guide = { name: "Scotiabank Arena", ...publicVenueFacts({ name: "Scotiabank Arena" }), guideLocationVerified: true };
  assert.equal(hasSubstantiveVenueGuide(guide), true);
  for (const override of [{ name: "" }, { place: "Unknown" }, { capacity: 0 }, { capacity: true },
    { coord: null }, { coord: { lat: 91, lng: 0 } }, { guideLocationVerified: false }]) {
    assert.equal(hasSubstantiveVenueGuide({ ...guide, ...override }), false);
  }
  assert.equal(hasSubstantiveVenueGuide({ name: "Bare room", place: "Toronto, Canada",
    heroPhoto: { url: "https://example.test/room.jpg" }, guide: { actions: [{ id: "parking" }] } }), false);
  assert.equal(hasSubstantiveVenueGuide(null), false);
});

test("venue locality uses full structured identity and never invents a country", () => {
  assert.equal(publicVenuePlace({ venue_city: " Toronto ", venue_region: "Ontario", venue_country: "Canada", place: "Wrong, USA" }), "Toronto, Ontario, Canada");
  assert.equal(publicVenuePlace({ venue_city: "Halifax", venue_country_code: "CA" }), "Halifax, CA");
  assert.equal(publicVenuePlace({ venue_city: "Toronto" }), null);
  assert.equal(publicVenuePlace({ place: " Toronto,  Canada " }), "Toronto, Canada");
});

test("public venue facts resolve curated rooms without crossing provider identities", () => {
  assert.deepEqual(publicVenueFacts({ name: "Scotiabank Arena" }), {
    place: "Toronto, Ontario, Canada",
    capacity: 19_800,
    coord: { lat: 43.6435, lng: -79.3791 },
  });
  assert.equal(publicVenueFacts({
    name: "Scotiabank Arena",
    place: "Halifax, Nova Scotia, Canada",
    providerVenueId: "other-room",
  }), null);
  assert.equal(publicVenueFacts({ name: "Scotiabank Arena", providerVenueId: "unlocated" }), null);
  assert.equal(publicVenueFacts({ name: "A room that is not curated" }), null);
});
