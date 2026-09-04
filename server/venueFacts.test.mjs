import assert from "node:assert/strict";
import test from "node:test";

import { publicVenueFacts } from "./venueFacts.js";

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
