import assert from "node:assert/strict";
import test from "node:test";
import { discoverPhotoFixture, publicTorontoPhoto } from "./verify-discover-photos-browser.mjs";

test("browser photo fixtures keep worldwide Toronto content separate from country empties", () => {
  assert.deepEqual(discoverPhotoFixture().photos, [publicTorontoPhoto]);
  assert.deepEqual(discoverPhotoFixture(new URLSearchParams({ country: "canada" })).photos, [publicTorontoPhoto]);
  assert.deepEqual(discoverPhotoFixture(new URLSearchParams({ country: "united states" })).photos, []);
  assert.throws(() => discoverPhotoFixture(new URLSearchParams({ city: "Toronto" })), /nearby event city/);
});
