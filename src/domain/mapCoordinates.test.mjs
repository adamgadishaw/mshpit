import assert from "node:assert/strict";
import test from "node:test";
import { mapCoordinate, mapPoint } from "./mapCoordinates.mjs";

test("map coordinates reject absence and coercible non-coordinate values instead of inventing zero", () => {
  for (const value of [null, undefined, "", " \t", true, false, [], [0], {}, { valueOf: () => 0 }, NaN, Infinity, -Infinity, "bad", 1n, Symbol("coordinate")]) {
    assert.equal(mapCoordinate({ lat: value, lng: 0 }), null);
    assert.equal(mapCoordinate({ lat: 0, lng: value }), null);
  }
  for (const point of [null, undefined, [], "51,-1", 0]) assert.equal(mapCoordinate(point), null);
});

test("map coordinates preserve genuine zero, valid numeric strings and geographic limits", () => {
  for (const point of [{ lat: 0, lng: 0 }, { lat: "0", lng: "0" }]) assert.deepEqual(mapCoordinate(point), { lat: 0, lng: 0 });
  assert.deepEqual(mapCoordinate({ lat: " 51.5 ", lng: "-.12" }), { lat: 51.5, lng: -.12 });
  assert.deepEqual(mapCoordinate({ lat: -90, lng: 180 }), { lat: -90, lng: 180 });
  for (const lat of [-90.1, 90.1]) assert.equal(mapCoordinate({ lat, lng: 0 }), null);
  for (const lng of [-180.1, 180.1]) assert.equal(mapCoordinate({ lat: 0, lng }), null);
});

test("map point normalization retains venue identity and metadata without mutating the source", () => {
  const original = Object.freeze({ id: "room", name: "London room", lat: "51.5", lng: "-.12", distanceKm: 2 });
  assert.deepEqual(mapPoint(original), { ...original, lat: 51.5, lng: -.12 });
  assert.equal(original.lat, "51.5");
  assert.equal(mapPoint({ name: "Unmapped room", lat: null, lng: null }), null);
});
