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
const { createSitemapSnapshot } = await import("./sitemapService.js");
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

test("city sitemap XML preserves saved modification dates and never invents dates for invalid or undated guides", () => {
  const generatedAt = Date.parse("2030-09-09T15:00:00Z");
  const savedAt = Date.parse("2025-04-06T19:30:00Z");
  const cases = [
    ["Saved City", "saved-city", savedAt, "2025-04-06"],
    ["Undated City", "undated-city", 0, null],
    ["Invalid Date City", "invalid-date-city", "not-a-timestamp", null],
    ["Out Of Range City", "out-of-range-city", 8_640_000_000_000_001, null],
    ["Negative Date City", "negative-date-city", -1, null],
  ];
  const insert = db.prepare(`INSERT INTO city_profiles
    (country_code,city_slug,city,country,editorial_json,updated_at) VALUES ('CA',?,?,'Canada',?,?)`);
  const editorial = JSON.stringify({ intro: "A local music guide with concert venues, music history, and practical advice for finding live performances in the city." });
  const rowFor = (xml, slug) => {
    const loc = `<loc>https://www.mshpit.com/city/ca/${slug}</loc>`;
    const row = [...xml.matchAll(/<url>[\s\S]*?<\/url>/g)].map(([value]) => value).find((value) => value.includes(loc));
    assert.ok(row, `Expected a public city guide entry for ${slug}`);
    return row;
  };
  try {
    for (const [city, slug, updatedAt] of cases) insert.run(slug, city, editorial, updatedAt);
    const snapshot = createSitemapSnapshot({ database: db, now: generatedAt });
    const xml = snapshot.xmlFor("/sitemaps/cities.xml");
    for (const [, slug, , expectedDay] of cases) {
      const row = rowFor(xml, slug);
      if (expectedDay) assert.ok(row.includes(`<lastmod>${expectedDay}</lastmod>`), slug);
      else assert.doesNotMatch(row, /<lastmod>/, slug);
      assert.doesNotMatch(row, /2030-09-09/, "Building a sitemap is not a city guide content update");
    }

    const editedAt = Date.parse("2026-06-07T09:15:00Z");
    db.prepare("UPDATE city_profiles SET updated_at=? WHERE country_code='CA' AND city_slug='saved-city'").run(editedAt);
    // Advance beyond the registry's one-minute public metadata cache, not the saved edit timestamp.
    const rebuilt = createSitemapSnapshot({ database: db, now: generatedAt + 60_001 }).xmlFor("/sitemaps/cities.xml");
    assert.match(rowFor(rebuilt, "saved-city"), /<lastmod>2026-06-07<\/lastmod>/);
    assert.match(rowFor(xml, "saved-city"), /<lastmod>2025-04-06<\/lastmod>/);
  } finally {
    const remove = db.prepare("DELETE FROM city_profiles WHERE country_code='CA' AND city_slug=?");
    for (const [, slug] of cases) remove.run(slug);
  }
});
