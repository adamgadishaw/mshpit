import assert from "node:assert/strict";
import test from "node:test";

import {
  AFTERPARTY_CATEGORIES,
  afterpartySearches,
  mapsSearch,
  verifiedVenueCoordinate,
} from "./afterparty.js";

test("afterparty discovery exposes truthful category searches instead of invented businesses", () => {
  const searches = afterpartySearches({ lat: 43.6532, lng: -79.3832 });
  assert.equal(searches.length, AFTERPARTY_CATEGORIES.length);
  assert.deepEqual(searches.map((item) => item.id), ["late-food", "bars", "clubs", "activities"]);
  for (const search of searches) {
    assert.match(search.url, /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
    assert.match(decodeURIComponent(search.url), /near 43\.6532,-79\.3832$/);
    assert.equal(Object.hasOwn(search, "name"), false, "Pit must not invent a business name");
    assert.equal(Object.hasOwn(search, "openUntil"), false, "Pit must not invent opening hours");
    assert.equal(Object.hasOwn(search, "walk"), false, "Pit must not invent walking times");
  }
});

test("missing or invalid venue coordinates produce an honest unavailable state", () => {
  assert.deepEqual(afterpartySearches(null), []);
  assert.deepEqual(afterpartySearches({ lat: 91, lng: 10 }), []);
  assert.deepEqual(afterpartySearches({ lat: 43, lng: -181 }), []);
  assert.equal(mapsSearch("bars open now", null), null);
  assert.equal(mapsSearch("", { lat: 43, lng: -79 }), null);
});

test("verified venue coordinates accept finite numeric input and reject ambiguous values", () => {
  assert.deepEqual(verifiedVenueCoordinate({ lat: "43.7", lng: "-79.4" }), { lat: 43.7, lng: -79.4 });
  assert.equal(verifiedVenueCoordinate({ lat: "", lng: -79.4 }), null);
  assert.equal(verifiedVenueCoordinate({ lat: "   ", lng: -79.4 }), null);
  assert.equal(verifiedVenueCoordinate({ lat: Number.NaN, lng: -79.4 }), null);
});
