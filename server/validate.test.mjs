import assert from "node:assert/strict";
import test from "node:test";

import { cleanLatitude, cleanLongitude } from "./validate.js";

test("geographic coordinates accept only finite real-world bounds", () => {
  assert.equal(cleanLatitude(-90), -90);
  assert.equal(cleanLatitude("90"), 90);
  assert.equal(cleanLongitude(-180), -180);
  assert.equal(cleanLongitude("180"), 180);

  for (const value of [-90.0001, 90.0001, Infinity, -Infinity, "NaN", "91north"]) {
    assert.equal(cleanLatitude(value), undefined);
  }
  for (const value of [-180.0001, 180.0001, Infinity, -Infinity, "NaN", "181east"]) {
    assert.equal(cleanLongitude(value), undefined);
  }
});
