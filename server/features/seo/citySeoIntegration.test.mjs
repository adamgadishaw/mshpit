import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CITY_EDITORIAL_SEEDS } from "../cities/cityEditorialSeeds.js";
import { CITY_PHOTO_SEEDS } from "../cities/cityPhotoSeeds.js";
import { validateCityEditorial } from "../cities/cityValidation.js";

const dataDir = mkdtempSync(join(tmpdir(), "pit-city-seo-"));
process.env.PIT_DATA_DIR = dataDir;
process.env.PUBLIC_ORIGIN = "https://www.mshpit.com";
const { db } = await import("../../db.js");
const { seoHttpPlan, injectHead } = await import("../../seo.js");
after(() => { db.close(); rmSync(dataDir, { recursive: true, force: true }); });

test("known city and directory URLs return rendered public documents; unknown city is404", () => {
  for (const path of ["/city/ca/toronto", "/cities"]) {
    const plan = seoHttpPlan(path);
    assert.equal(plan.status, 200);
    assert.equal(plan.type, "document");
    const html = injectHead("<!doctype html><html><head></head><body><div id=\"root\"></div></body></html>", path, plan);
    assert.match(html, /application\/ld\+json/);
    assert.match(html, /Toronto/);
    assert.doesNotMatch(html, /"@type":"MusicEvent"/);
  }
  assert.equal(seoHttpPlan("/city/xx/nonexistent-city").status, 404);
  assert.equal(seoHttpPlan("/City/CA/Toronto").location, "/city/ca/toronto");
});
test("initial city histories and photo licenses validate and every bundled image exists", () => {
  assert.ok(CITY_EDITORIAL_SEEDS.length >= 21);
  for (const seed of CITY_EDITORIAL_SEEDS) {
    assert.doesNotThrow(() => validateCityEditorial(seed.editorial), seed.city);
    assert.ok(seed.editorial.sources.length, seed.city);
    assert.ok(seed.editorial.stockImage?.url, seed.city);
  }
  for (const row of CITY_PHOTO_SEEDS) {
    assert.ok(row.photo.credit);
    assert.ok(row.photo.sourceUrl.startsWith("https://commons.wikimedia.org/"));
    assert.ok(existsSync(new URL("../../.."+"/public"+row.photo.url, import.meta.url)), row.key);
  }
});
test("city guide stock photos are served from site assets and not visitor-time third parties", () => {
  const plan = seoHttpPlan("/city/ca/toronto");
  assert.match(plan.document.cityGuide.photos.at(-1).url, /^https:\/\/www\.mshpit\.com\/images\/cities\//);
  assert.match(plan.document.cityGuide.copy.welcomeBannerUrl, /^\/images\/cities\//);
});
