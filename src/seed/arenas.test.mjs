import assert from "node:assert/strict";
import test from "node:test";

import { arenaVenueEntries, arenaVenues } from "./arenas.js";

const countryOf = (place) => String(place).split(", ").at(-1);

const EUROPE_COUNTRY_MINIMUMS = Object.freeze({
  Portugal: 5,
  Spain: 8,
  "United Kingdom": 8,
  Ireland: 3,
  France: 6,
  Germany: 7,
  Italy: 6,
  Netherlands: 4,
  Belgium: 3,
  Switzerland: 2,
  Austria: 2,
  Denmark: 2,
  Sweden: 3,
  Norway: 2,
  Finland: 2,
  Poland: 3,
  Czechia: 2,
});

test("Portugal and Spain include the major touring anchors", () => {
  const expected = Object.freeze({
    "meo arena": "Portugal",
    "estádio da luz": "Portugal",
    "estádio josé alvalade": "Portugal",
    "estádio do dragão": "Portugal",
    "super bock arena": "Portugal",
    "riyadh air metropolitano": "Spain",
    "movistar arena madrid": "Spain",
    "estadio santiago bernabéu": "Spain",
    "spotify camp nou": "Spain",
    "estadi olímpic lluís companys": "Spain",
    "palau sant jordi": "Spain",
    "estadio la cartuja": "Spain",
    "roig arena": "Spain",
  });

  for (const [key, country] of Object.entries(expected)) {
    assert.ok(arenaVenues[key], `missing venue anchor: ${key}`);
    assert.equal(countryOf(arenaVenues[key].place), country);
  }
});

test("European anchors span the intended touring countries", () => {
  const counts = new Map();
  for (const [, venue] of arenaVenueEntries) {
    const country = countryOf(venue.place);
    counts.set(country, (counts.get(country) || 0) + 1);
  }

  for (const [country, minimum] of Object.entries(EUROPE_COUNTRY_MINIMUMS)) {
    assert.ok(
      (counts.get(country) || 0) >= minimum,
      `expected at least ${minimum} arena anchors for ${country}`,
    );
  }
});

test("curated venue entries keep unique keys and valid static facts", () => {
  const keys = arenaVenueEntries.map(([key]) => key);
  assert.equal(new Set(keys).size, keys.length, "venue keys must be unique");
  assert.equal(Object.keys(arenaVenues).length, arenaVenueEntries.length);

  for (const [key, venue] of arenaVenueEntries) {
    assert.equal(key, venue.name.toLowerCase());
    assert.ok(venue.name.trim());
    assert.ok(venue.place.trim());
    assert.ok(Number.isFinite(venue.lat) && venue.lat >= -90 && venue.lat <= 90);
    assert.ok(Number.isFinite(venue.lng) && venue.lng >= -180 && venue.lng <= 180);
    assert.ok(Number.isInteger(venue.capacity) && venue.capacity > 0);
    assert.equal(venue.photo, null);
    assert.equal(venue.photoCredit, null);
    assert.equal(venue.major, true);
  }
});
