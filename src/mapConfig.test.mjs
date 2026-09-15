import assert from "node:assert/strict";
import test from "node:test";

test("Google static maps target the requested place and scope dark colors to the correct elements", async () => {
  const original = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY;
  let config;
  try {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY = "fixture-only";
    config = await import("./mapConfig.js?google-static-style-test");
  } finally {
    if (original === undefined) delete process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY;
    else process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY = original;
  }
  const url = new URL(config.mapStaticUrl({ lat: 51.5074, lng: -0.1278 }, 12, 640, 420));
  assert.equal(url.hostname, "maps.googleapis.com");
  assert.equal(url.searchParams.get("center"), "51.5074,-0.1278");
  assert.equal(url.searchParams.get("zoom"), "12");
  assert.equal(url.searchParams.get("size"), "640x420");
  const styles = url.searchParams.getAll("style");
  assert.ok(styles.includes("element:geometry|color:0x0f131c"));
  assert.ok(styles.includes("element:labels.text.fill|color:0x8088a0"));
  assert.ok(styles.includes("element:labels.text.stroke|color:0x0b0e16"));
  assert.ok(styles.includes("feature:road|element:geometry|color:0x262d43"));
  assert.ok(styles.every(style => !style.startsWith("color:")), "Label colors must never recolor the entire basemap.");
  for (const invalid of [null, {}, { lat: null, lng: null }, { lat: " ", lng: "" }, { lat: false, lng: [] }, { lat: 91, lng: 0 }]) {
    assert.equal(config.mapStaticUrl(invalid, 12, 640, 420), null, "Missing coordinates must not trigger a fake-origin map request.");
  }
  assert.equal(new URL(config.mapStaticUrl({ lat: 0, lng: "0" }, 12, 640, 420)).searchParams.get("center"), "0,0");
});
