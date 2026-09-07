import assert from "node:assert/strict";
import test from "node:test";
import { cityIdentityForLocation } from "./cityIdentity.js";
import { cityPath } from "./domain/urls.mjs";

test("review locations keep their country and region instead of guessing same-name cities", () => {
  assert.equal(cityIdentityForLocation("London"), null);
  assert.equal(cityIdentityForLocation({city:"Portland",countryCode:"US"}), null);
  const maine = cityIdentityForLocation("Portland, Maine, United States");
  const oregon = cityIdentityForLocation({city:"Portland",countryCode:"US",venueRegion:"OR"});
  assert.equal(cityPath(maine), "/city/us/portland-maine");
  assert.equal(cityPath(oregon), "/city/us/portland-oregon");
  assert.equal(cityPath(cityIdentityForLocation({city:"London",countryCode:"CA"})), "/city/ca/london");
});
test("city links preserve provider native-script aliases and API canonical regions", () => {
  assert.equal(cityPath(cityIdentityForLocation({city:"東京",countryCode:"JP"})), "/city/jp/tokyo");
  assert.equal(cityPath(cityIdentityForLocation({city:"Portland",countryCode:"US",region:"Maine",citySlug:"portland-maine"})), "/city/us/portland-maine");
});
