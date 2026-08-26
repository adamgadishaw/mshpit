import assert from "node:assert/strict";
import test from "node:test";
import { artistConcertsPath, artistsPath, cityConcertsPath, cityVenuesPath, eventsPath, parsePath, parsePublicCollectionPath } from "./urls.mjs";
test("collection builders keep page one canonical and reject invalid pages", () => {
  assert.equal(artistsPath(), "/artists"); assert.equal(eventsPath(2), "/events/page/2");
  assert.equal(artistsPath(0), null); assert.equal(artistsPath(1.5), null);
  assert.deepEqual(parsePublicCollectionPath("/artists/page/1"), { type: "artists", page: 1, nonCanonicalPageOne: true });
  for (const path of ["/artists/page/0", "/events/page/-1", "/artists/page/2/extra"]) assert.equal(parsePublicCollectionPath(path), null);
  assert.equal(parsePath("/artists"), null, "legacy app-route parsing is unchanged");
});
test("city paths require structured country and city rather than free-form place", () => {
  assert.equal(cityVenuesPath({ venueCountryCode: "CA", venueCity: "Montréal" }), "/venues/ca/montreal");
  assert.equal(cityConcertsPath({ venue_country_code: "US", venue_city: "Portland" }, 3), "/concerts/us/portland/page/3");
  assert.equal(cityVenuesPath({ place: "Toronto, Canada" }), null);
  assert.equal(cityVenuesPath({ homeCity: "Toronto", countryCode: "CA" }), null);
  assert.notEqual(cityVenuesPath({ countryCode: "CA", city: "London" }), cityVenuesPath({ countryCode: "GB", city: "London" }));
});
test("artist archive paths are stable and separately parsed", () => {
  assert.equal(artistConcertsPath({ public_slug: "bruno-mars" }), "/artist/bruno-mars/concerts");
  assert.equal(artistConcertsPath("Bruno Mars", 2), "/artist/bruno-mars/concerts/page/2");
  assert.deepEqual(parsePublicCollectionPath("/artist/bruno-mars/concerts/page/2"), { type: "artist-concerts", artistSlug: "bruno-mars", page: 2, nonCanonicalPageOne: false });
});
