import test from "node:test";
import assert from "node:assert/strict";
import { nextGroupVenue, venueFeatureCollection, viewportFeatureKey } from "../../public/mshpit-maplibre/cluster-model.mjs";
test("full catalogue enters the worker source without a result cap", () => {
  const rows = Array.from({ length: 10001 }, (_, i) => ({ id: `venue-${i}`, coord: { lat: 10 + i / 1000, lng: -80 } }));
  const model = venueFeatureCollection(rows);
  assert.equal(model.data.features.length, rows.length);
  assert.equal([...model.groups.values()].flat().length, rows.length);
});
test("coincident venues stay distinct and cycle at their actual coordinate", () => {
  const rows = ["a", "b", "c"].map(id => ({ id, coord: { lat: 43, lng: -79 } }));
  const model = venueFeatureCollection(rows);
  assert.equal(model.data.features.length, 1);
  assert.equal(model.data.features[0].properties.venueCount, 3);
  assert.deepEqual(model.data.features[0].geometry.coordinates, [-79, 43]);
  assert.equal(nextGroupVenue(rows, null), "a");
  assert.equal(nextGroupVenue(rows, "a"), "b");
  assert.equal(nextGroupVenue(rows, "c"), "a");
});
test("viewport deduplication uses cluster identity without merging separate venues", () => {
  assert.equal(viewportFeatureKey({ properties: { cluster: true, cluster_id: 5 } }), "cluster:5");
  assert.notEqual(viewportFeatureKey({ properties: { key: "a" } }), viewportFeatureKey({ properties: { key: "b" } }));
});
test("invalid points do not invent a location; genuine zero remains valid", () => {
  const model = venueFeatureCollection([{ coord: { lat: 0, lng: 10 } }, { coord: { lat: NaN, lng: 0 } }, { coord: { lat: 90, lng: 2 } }]);
  assert.equal(model.data.features.length, 1);
  assert.deepEqual(model.data.features[0].geometry.coordinates, [10, 0]);
});
