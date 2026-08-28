import assert from "node:assert/strict";
import test from "node:test";

import { desktopRightRailLayout } from "./desktopRailLayout.mjs";

test("a 15-inch Mac-sized browser gets the compact right rail without squeezing the feed", () => {
  assert.deepEqual(desktopRightRailLayout({ viewportWidth: 1_440 }), {
    visible: true,
    width: 300,
    availableWidth: 1_440,
    centerWidth: 1_140,
  });
});

test("right rail visibility follows usable content width rather than viewport alone", () => {
  assert.equal(desktopRightRailLayout({ viewportWidth: 1_440, playerColumnWidth: 460 }).visible, false);
  assert.equal(desktopRightRailLayout({ viewportWidth: 1_440, playerColumnWidth: 82 }).visible, true);
  assert.equal(desktopRightRailLayout({ viewportWidth: 1_100, desktop: false }).visible, false);
  assert.equal(desktopRightRailLayout({ viewportWidth: Number.NaN }).visible, false);
});

test("large desktops keep the full-width discovery rail", () => {
  const layout = desktopRightRailLayout({ viewportWidth: 1_720 });
  assert.equal(layout.visible, true);
  assert.equal(layout.width, 340);
  assert.equal(layout.centerWidth, 1_380);
});
