import test from "node:test";
import assert from "node:assert/strict";
import { venueDirectoryGroups } from "./venueDirectory.mjs";
import { createUnifiedVenueSearchIndex, memoizedUnifiedVenueSearchIndex, searchUnifiedVenueIndex } from "./unifiedLocationSearch.mjs";
import { venueDirectoryTotals } from "./venueDiscovery.mjs";
import { publicVenueRequestPath } from "./publicVenueSnapshot.mjs";

const event = (id, providerVenueId, city = "Toronto", venue = "History Toronto") => ({
  id, source: "ticketmaster", providerVenueId, venue, venueCity: city,
  place: `${city}, Ontario, Canada`, venueCountry: "Canada", date: "2099-12-01", releaseAt: 0,
});
const anchors = [{ name: "History", place: "Toronto, Ontario, Canada" },
  { name: "Unmapped anchor", place: "Toronto, Ontario, Canada" }];

test("city browse preserves search identity, provider case, counts and separate rooms", () => {
  const index = createUnifiedVenueSearchIndex({ curatedVenues: anchors, tourDates: [
    event("a", "KovZ917AJ4F"), event("b", "KovZ917AJ4F"),
    event("c", "DistinctID"), event("d", "OttawaID", "Ottawa", "History"),
    { ...event("hidden", "KovZ917AJ4F"), releaseAt: Date.parse("2100-01-01") },
  ] });
  const groups = venueDirectoryGroups(index);
  const toronto = groups.find(group => group.city === "Toronto");
  assert.equal(toronto.count, 3);
  assert.equal(toronto.upcoming, 3);
  const browse = toronto.venues.find(row => row.providerVenueId === "KovZ917AJ4F");
  const search = searchUnifiedVenueIndex(index, "History").find(row => row.providerVenueId === "KovZ917AJ4F");
  assert.deepEqual(browse, search);
  assert.equal(browse.upcoming, 2);
  assert.equal(publicVenueRequestPath(browse.name, browse), publicVenueRequestPath(search.name, search));
  assert.match(publicVenueRequestPath(browse.name, browse), /ticketmaster-/);
  assert.equal(groups.find(group => group.city === "Ottawa").upcoming, 1);
  const anchor = toronto.venues.find(row => row.name === "Unmapped anchor");
  assert.equal(anchor.upcoming, 0);
  assert.equal(anchor.coord, null);
  assert.equal(anchor.providerVenueId, null);
  assert.equal(groups.reduce((sum, group) => sum + group.count, 0), index.length);
  assert.deepEqual(venueDirectoryTotals(groups), { cities: 2, venues: 4, upcoming: 4 });
});

test("late hydration and refreshed snapshots replace anchor navigation and counts", () => {
  const project = tourDates => venueDirectoryGroups(memoizedUnifiedVenueSearchIndex({ tourDates, curatedVenues: anchors }));
  const initial = project([]);
  assert.equal(initial[0].upcoming, 0);
  const hydrated = project([event("a", "KovZ917AJ4F")]);
  assert.equal(hydrated[0].count, 2);
  assert.equal(hydrated[0].upcoming, 1);
  assert.equal(hydrated[0].venues[0].providerVenueId, "KovZ917AJ4F");
  const refreshed = project([event("a", "KovZ917AJ4F"), event("b", "KovZ917AJ4F")]);
  assert.equal(refreshed[0].upcoming, 2);
  assert.equal(hydrated[0].upcoming, 1, "grouping never mutates an earlier snapshot");
});
