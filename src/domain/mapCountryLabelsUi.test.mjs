import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { mapPoint } from "./mapCoordinates.mjs";

const liveMap = readFileSync(new URL("../components/LiveMap.jsx", import.meta.url), "utf8");
const staticMap = readFileSync(new URL("../mapConfig.js", import.meta.url), "utf8");

test("nearby maps hide misleading country labels while retaining local labels", () => {
  assert.match(liveMap, /featureType:\s*"administrative\.country"[\s\S]*?visibility:\s*"off"/);
  assert.match(liveMap, /featureType:\s*"administrative\.locality"[\s\S]*?labels\.text\.fill/);
  assert.match(liveMap, /featureType:\s*"administrative\.neighborhood"[\s\S]*?labels\.text\.fill/);
  assert.match(staticMap, /feature:\s*"administrative\.country"[\s\S]*?visibility:\s*"off"/);
});

test("nearby maps reject malformed coordinates before formatting or plotting", () => {
  assert.match(liveMap, /import \{ mapPoint \} from "\.\.\/domain\/mapCoordinates\.mjs"/);
  assert.match(liveMap, /\(Array\.isArray\(points\) \? points : \[\]\)\.map\(mapPoint\)\.filter\(Boolean\)/);
  assert.match(liveMap, /const focal = mapPoint\(highlight\)/);
  for (const point of [{ lat: null, lng: null }, { lat: " ", lng: "" }, { lat: 91, lng: 0 }]) assert.equal(mapPoint(point), null);
  assert.deepEqual(mapPoint({ lat: 0, lng: "0" }), { lat: 0, lng: 0 });
});
