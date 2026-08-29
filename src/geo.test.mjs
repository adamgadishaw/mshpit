import assert from "node:assert/strict";
import test from "node:test";

import { countryForCity, GEO } from "./geo.js";

test("the location directory includes Portugal, Spain, and broad European touring markets", () => {
  const europe = GEO.Europe;
  assert.ok(Object.keys(europe).length >= 25);
  assert.deepEqual(europe.Portugal, { Lisbon: ["Lisbon"], Porto: ["Porto"], Braga: ["Braga"] });
  assert.deepEqual(europe.Spain.Madrid, ["Madrid"]);
  assert.deepEqual(europe.Spain.Catalonia, ["Barcelona"]);
  assert.equal(countryForCity("Lisbon"), "Portugal");
  assert.equal(countryForCity("Porto"), "Portugal");
  assert.equal(countryForCity("Madrid"), "Spain");
  assert.equal(countryForCity("Vienna"), "Austria");
});
