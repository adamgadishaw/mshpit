import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { discoveryGridLayout } from "./discoveryGridLayout.mjs";

test("phone sections use their full measured width in one vertical column", () => {
  for (const width of [240, 266, 292, 336, 362, 402, 460]) {
    assert.deepEqual(discoveryGridLayout(width), { columns: 1, gap: 12, tileWidth: width });
  }
});

test("wider sections form bounded two or three column grids", () => {
  assert.deepEqual(discoveryGridLayout(484), { columns: 2, gap: 12, tileWidth: 236 });
  assert.deepEqual(discoveryGridLayout(650), { columns: 2, gap: 12, tileWidth: 319 });
  assert.deepEqual(discoveryGridLayout(732), { columns: 3, gap: 12, tileWidth: 236 });
  assert.equal(discoveryGridLayout(2000).columns, 3);
});

test("grid rows never exceed their measured container", () => {
  for (let width = 240; width <= 1500; width += 1) {
    const { columns, gap, tileWidth } = discoveryGridLayout(width);
    assert.ok(columns * tileWidth + (columns - 1) * gap <= width);
  }
  assert.equal(discoveryGridLayout(undefined).columns, 1);
  assert.equal(discoveryGridLayout(-1).columns, 1);
  assert.equal(discoveryGridLayout(Infinity).tileWidth, 1);
});

test("city and photo grids retain links and gallery indices without nested horizontal scrolling", () => {
  const cities = readFileSync(new URL("../components/cities/CityDirectoryTiles.jsx", import.meta.url), "utf8");
  const photos = readFileSync(new URL("../components/discover/DiscoverCommunity.jsx", import.meta.url), "utf8");
  for (const source of [cities, photos]) {
    assert.doesNotMatch(source, /ScrollView|\bhorizontal\b/);
    assert.match(source, /flexWrap: "wrap"/);
    assert.match(source, /event\.nativeEvent\.layout\.width/);
    assert.match(source, /width: layout\.tileWidth|width=\{layout\.tileWidth\}/);
  }
  assert.match(cities, /onOpenCity=\{onOpenCity\}/);
  assert.match(photos, /onOpenPhotos\?\.\(photoUris, index\)/);
  assert.match(photos, /mediaKind="image"/);
  assert.match(photos, /<ClipPoster/);
});
