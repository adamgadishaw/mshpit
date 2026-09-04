import assert from "node:assert/strict";
import test from "node:test";

import {
  venueCapacity,
  venueCoordinates,
  venueGuideModel,
  venuePlacesMatch,
} from "./venueGuide.mjs";

test("venue guide keeps only verified capacity and coordinate values", () => {
  assert.equal(venueCapacity(19_800), 19_800);
  assert.equal(venueCapacity("19800"), 19_800);
  assert.equal(venueCapacity(0), null);
  assert.equal(venueCapacity(false), null);
  assert.deepEqual(venueCoordinates({ lat: 43.6435, lng: -79.3791 }), { lat: 43.6435, lng: -79.3791 });
  assert.equal(venueCoordinates({ lat: 91, lng: -79 }), null);
  assert.equal(venueCoordinates({ lat: 43, lng: null }), null);
});

test("venue place matching tolerates region wording but not another city or country", () => {
  assert.equal(venuePlacesMatch("Toronto, Ontario, Canada", "Toronto, ON, Canada"), true);
  assert.equal(venuePlacesMatch("Chicago, Illinois, United States", "Chicago, IL, USA"), true);
  assert.equal(venuePlacesMatch("London, Ontario, Canada", "London, England, United Kingdom"), false);
  assert.equal(venuePlacesMatch("Toronto", "Toronto, Ontario, Canada"), false);
});

test("venue guide offers live searches without manufacturing local businesses", () => {
  const guide = venueGuideModel({
    name: "Scotiabank Arena",
    place: "Toronto, Ontario, Canada",
    capacity: 19_800,
    coord: { lat: 43.6435, lng: -79.3791 },
  });

  assert.equal(guide.capacityLabel, "19,800");
  assert.match(guide.seatingSummary, /layouts can change by event/u);
  assert.deepEqual(guide.actions.map(({ id }) => id), ["directions", "parking", "transit"]);
  assert.ok(guide.actions.every(({ url }) => url.startsWith("https://www.google.com/maps/")));
  assert.match(new URL(guide.actions[1].url).searchParams.get("query"), /parking near Scotiabank Arena, Toronto/u);
  assert.doesNotMatch(JSON.stringify(guide), /lot|price|hours|distance/iu);
});

test("sparse venue guides remain useful without pretending an unknown location is actionable", () => {
  const guide = venueGuideModel({ name: "Unknown Room" });
  assert.equal(guide.capacity, null);
  assert.match(guide.seatingSummary, /vary by event/u);
  assert.deepEqual(guide.actions, []);
});
