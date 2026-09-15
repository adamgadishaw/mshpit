import assert from "node:assert/strict";
import test from "node:test";
import { fitBox, linearProjector, pixelProjector, mercatorProjector, MAP_W, MAP_H } from "./mapProject.js";

function providerPixel(point, center, zoom) {
  let deltaLng = point.lng - center.lng;
  while (deltaLng >= 180) deltaLng -= 360;
  while (deltaLng < -180) deltaLng += 360;
  const northing = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / (2 * Math.PI);
  const scale = 256 * 2 ** zoom;
  return {
    x: MAP_W / 2 + deltaLng * scale / 360,
    y: MAP_H / 2 + (northing(center.lat) - northing(point.lat)) * scale,
  };
}

test("empty and invalid projection input does not invent a geographic origin", () => {
  for (const coords of [[], null, [{ lat: null, lng: null }], [{ lat: "", lng: "" }], [{ lat: 91, lng: 0 }]]) {
    assert.equal(fitBox(coords), null);
    assert.equal(linearProjector(coords), null);
    assert.equal(pixelProjector(coords, MAP_W, MAP_H), null);
    assert.equal(mercatorProjector(coords), null);
  }
  assert.equal(pixelProjector([{ lat: 0, lng: 0 }], 0, MAP_H), null);
});

test("existing London and Toronto map framing retains its normal city zoom and center", () => {
  for (const [coords, center, expectedFirst] of [
    [[{ lat: 51.5074, lng: -.1278 }, { lat: 51.539, lng: -.1426 }, { lat: 51.503, lng: -.019 }], { lat: 51.521, lng: -.0808 }, [.28609777777783163, .6544987219189422]],
    [[{ lat: 43.6387, lng: -79.3806 }, { lat: 43.6655, lng: -79.4112 }, { lat: 43.6656, lng: -79.3114 }], { lat: 43.65215, lng: -79.3613 }, [.4121635555556168, .6314041210103665]],
  ]) {
    const projection = pixelProjector(coords, MAP_W, MAP_H);
    assert.equal(projection.zoom, 11);
    assert.ok(Math.abs(projection.center.lat - center.lat) < 1e-10);
    assert.ok(Math.abs(projection.center.lng - center.lng) < 1e-10);
    assert.ok(Math.abs(projection.xPct(coords[0].lng) - expectedFirst[0]) < 1e-10);
    assert.ok(Math.abs(projection.yPct(coords[0].lat) - expectedFirst[1]) < 1e-10);
  }
});

for (const [direction, coords, expectedLng] of [
  ["east", [{ lat: -16.5, lng: 179.8 }, { lat: -16.4, lng: -179.4 }], -179.8],
  ["west", [{ lat: -16.5, lng: 179.4 }, { lat: -16.4, lng: -179.8 }], 179.8],
]) {
  test(`legacy ${direction} dateline fit remains local and matches independent provider pixels`, () => {
    for (const points of [coords, [...coords].reverse()]) {
      const box = fitBox(points);
      assert.ok(box.maxLng - box.minLng < 2);
      const projection = pixelProjector(points, MAP_W, MAP_H);
      assert.ok(Math.abs(projection.center.lng - expectedLng) < 1e-9);
      for (const point of points) {
        const expected = providerPixel(point, projection.center, projection.zoom);
        const x = projection.xPct(point.lng), y = projection.yPct(point.lat);
        assert.ok(x > 0 && x < 1 && y > 0 && y < 1);
        assert.ok(Math.abs(x * MAP_W - expected.x) < 1e-7);
        assert.ok(Math.abs(y * MAP_H - expected.y) < 1e-7);
      }
      for (const fit of [linearProjector(points), mercatorProjector(points)]) {
        for (const point of points) assert.ok(fit.xPct(point.lng) > 0 && fit.xPct(point.lng) < 1);
      }
    }
  });
}

test("true dateline endpoints share one center instead of opposite image edges", () => {
  const points = [{ lat: 12, lng: 180 }, { lat: 12, lng: -180 }];
  const projection = pixelProjector(points, MAP_W, MAP_H);
  assert.equal(Math.abs(projection.center.lng), 180);
  assert.ok(Math.abs(projection.xPct(180) - projection.xPct(-180)) < 1e-12);
});

test("Mercator polar positions are clamped to a finite map domain", () => {
  for (const lat of [-90, 90]) {
    const point = { lat, lng: 20 };
    const projection = pixelProjector([point], MAP_W, MAP_H);
    assert.ok(Number.isFinite(projection.zoom));
    assert.ok(Number.isFinite(projection.center.lat));
    assert.ok(Math.abs(projection.center.lat) <= 85.05112878);
    assert.ok(Number.isFinite(projection.yPct(lat)));
    const mercator = mercatorProjector([point]);
    assert.ok(mercator.bbox.every(Number.isFinite));
    assert.ok(Number.isFinite(mercator.yPct(lat)));
  }
});

test("projection validates numeric strings without corrupting input or real zero coordinates", () => {
  const points = [{ lat: "0", lng: "0" }, { lat: null, lng: null }];
  const before = structuredClone(points);
  const projection = pixelProjector(points, MAP_W, MAP_H);
  assert.deepEqual(projection.center, { lat: 0, lng: 0 });
  assert.deepEqual(points, before);
  assert.equal(projection.xPct(0), .5);
  assert.equal(projection.yPct(0), .5);
});

test("exported projection accessors stay bounded even for invalid extreme longitudes", () => {
  const projection = pixelProjector([{ lat: 0, lng: 0 }], MAP_W, MAP_H);
  assert.ok(Number.isNaN(projection.xPct(Infinity)));
  assert.ok(Number.isFinite(projection.xPct(Number.MAX_VALUE)));
});
