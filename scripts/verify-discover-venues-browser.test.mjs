import assert from "node:assert/strict";
import test from "node:test";
import { discoverVenueFixture, discoverVenueEvents } from "./verify-discover-venues-browser.mjs";

test("venue browser fixtures use public source identities across two cities without real accounts", () => {
  assert.equal(discoverVenueFixture("/api/me").user, null);
  assert.deepEqual(discoverVenueFixture("/api/tourdates").tourDates, discoverVenueEvents);
  assert.deepEqual(new Set(discoverVenueEvents.map(row => row.venueCountry)), new Set(["Canada", "Portugal"]));
  assert.ok(discoverVenueEvents.every(row => row.source === "ticketmaster" && row.providerVenueId && row.releaseAt === 0));
  assert.ok(discoverVenueEvents.some(row => row.lat === null && row.lng === null));
  assert.ok(discoverVenueEvents.some(row => row.venue.includes("Écho")));
});

test("venue browser fixture refuses anonymous mutations and unexpected API reads", () => {
  assert.throws(() => discoverVenueFixture("/api/posts", { method: "POST" }), /must not mutate/);
  assert.throws(() => discoverVenueFixture("/api/feed"), /Guests must never/);
  assert.throws(() => discoverVenueFixture("/api/unknown"), /Missing navigation fixture/);
});
