import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test, { after, beforeEach } from "node:test";
import { venuePath } from "../src/domain/urls.mjs";

const directory = mkdtempSync(join(tmpdir(), "pit-evergreen-venue-seo-"));
process.env.PIT_DATA_DIR = directory;
process.env.PUBLIC_ORIGIN = "https://www.example.test";
const { db } = await import("./db.js");
const { seoHttpPlan, injectHead } = await import("./seo.js");
const { venueSitemapEntries, urlsetParts } = await import("./features/seo/sitemapService.js");
const modified = Date.parse("2020-01-02T10:00:00Z");
const insert = db.prepare(`INSERT INTO tour_dates
  (id,artist,venue,place,date,source,updated_at,release_at,provider_active,music_qualified,
    venue_provider_id,venue_city,venue_region,venue_country_code,venue_country)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
function add(id, { name = "Scotiabank Arena", place = "Toronto, Ontario, Canada", date = "2020-01-01",
  providerId = id, city = "Toronto", region = "Ontario", countryCode = "CA", country = "Canada",
  updatedAt = modified, releaseAt = 0, active = 0, music = 1 } = {}) {
  insert.run(id, "Evergreen Fixture Artist", name, place, date, "ticketmaster", updatedAt,
    releaseAt, active, music, providerId, city, region, countryCode, country);
  return venuePath({ name, source: "ticketmaster", providerVenueId: providerId });
}
const entries = () => venueSitemapEntries(db, { now: Date.now() });
beforeEach(() => db.exec("DELETE FROM tour_dates"));
after(() => {
  db.close();
  const target = realpathSync(directory);
  assert.equal(dirname(target).toLowerCase(), realpathSync(tmpdir()).toLowerCase());
  assert.ok(basename(target).startsWith("pit-evergreen-venue-seo-"));
  rmSync(target, { recursive: true, force: true });
});

test("a withdrawn past show keeps a verified venue guide indexable without inventing upcoming dates", () => {
  const path = add("evergreen-toronto");
  const plan = seoHttpPlan(path);
  assert.equal(plan.type, "document");
  assert.equal(plan.indexable, true);
  assert.deepEqual(plan.document.events, []);
  assert.equal(plan.document.venue.capacity, 19_800);
  assert.equal(plan.document.venue.place, "Toronto, Ontario, Canada");
  assert.equal(plan.document.venue.guideLocationVerified, true);
  const listed = entries().find(row => row.path === path);
  assert.ok(listed);
  assert.equal(listed.lastmod, modified);
  const html = injectHead('<html><head></head><body><div id="root"></div></body></html>', path, plan, { PIT_ENV: "production" });
  assert.match(html, /name="robots" content="index,follow/);
  assert.match(html, /19,800/);
  assert.match(html, /canonical" href="https:\/\/www\.example\.test\/venue\/ticketmaster-evergreen-toronto/);
});

test("unknown rooms, mismatched cities, and unlocated copies do not become evergreen sitemap pages", () => {
  const paths = [
    add("unknown-room", { name: "Empty Fixture Hall" }),
    add("wrong-city", { place: "Halifax, Nova Scotia, Canada", city: "Halifax", region: "Nova Scotia" }),
    add("missing-location", { place: "", city: "", region: "", country: "", countryCode: "" }),
  ];
  for (const path of paths) {
    assert.equal(seoHttpPlan(path).indexable, false, path);
    assert.equal(entries().some(row => row.path === path), false, path);
  }
});

test("unreleased, inactive future and nonmusic provider rows cannot seed evergreen guides", () => {
  const paths = [
    add("unreleased", { releaseAt: Date.now() + 60_000 }),
    add("inactive-future", { date: "2099-01-01" }),
    add("sports-only", { music: 0 }),
  ];
  for (const path of paths) {
    assert.notEqual(seoHttpPlan(path).indexable, true, path);
    assert.equal(entries().some(row => row.path === path), false, path);
  }
});

test("name-only history must match the curated city before receiving evergreen eligibility", () => {
  const path = add("name-only", { providerId: null });
  assert.equal(seoHttpPlan(path).indexable, true);
  assert.equal(entries().some(row => row.path === path), true);
  db.prepare("UPDATE tour_dates SET place='Halifax, Nova Scotia, Canada',venue_city='Halifax',venue_region='Nova Scotia' WHERE id='name-only'").run();
  assert.equal(seoHttpPlan(path).indexable, false);
  assert.equal(entries().some(row => row.path === path), false);
});

test("the latest exact-provider locality governs the guide, not an older convenient match", () => {
  const path = add("older-match", { providerId: "same-provider" });
  add("newer-mismatch", { providerId: "same-provider", updatedAt: modified + 1,
    place: "Halifax, Nova Scotia, Canada", city: "Halifax", region: "Nova Scotia" });
  assert.equal(seoHttpPlan(path).indexable, false);
  assert.equal(entries().some(row => row.path === path), false);
});

test("an evergreen venue stays indexable after its last date leaves the calendar", () => {
  const path = add("calendar-rollover", { date: "2099-01-01", active: 1 });
  assert.equal(seoHttpPlan(path).document.events.length, 1);
  assert.equal(seoHttpPlan(path).indexable, true);
  db.prepare("UPDATE tour_dates SET date='2020-01-01',provider_active=0 WHERE id='calendar-rollover'").run();
  assert.equal(seoHttpPlan(path).document.events.length, 0);
  assert.equal(seoHttpPlan(path).indexable, true);
  assert.equal(entries().some(row => row.path === path), true);
});

test("evergreen venues without a modification timestamp are listed without a fabricated lastmod", () => {
  const path = add("unknown-modification", { updatedAt: 0 });
  const rows = entries().filter(row => row.path === path);
  assert.equal(rows.length, 1);
  const parts = urlsetParts(rows, "https://www.example.test");
  assert.equal(parts.length, 1);
  assert.match(parts[0], /https:\/\/www\.example\.test\/venue\/ticketmaster-unknown-modification/);
  assert.doesNotMatch(parts[0], /<lastmod>/);
});

test("newer nonmusic and parking history cannot replace a valid music venue's canonical identity", () => {
  for (const kind of ["nonmusic", "parking"]) {
    const providerId = `identity-${kind}`;
    const path = add(`valid-${kind}`, { providerId });
    add(`invalid-${kind}`, { providerId, name: "Uncurated Renamed Room", updatedAt: modified + 1,
      music: kind === "nonmusic" ? 0 : 1 });
    if (kind === "parking") {
      db.prepare("UPDATE tour_dates SET event_name='Parking Pass' WHERE id=?").run(`invalid-${kind}`);
    }
    const plan = seoHttpPlan(path);
    assert.equal(plan.type, "document", kind);
    assert.equal(plan.canonicalPath, path, kind);
    assert.equal(plan.document.venue.name, "Scotiabank Arena", kind);
    assert.equal(plan.document.venue.capacity, 19_800, kind);
    assert.equal(plan.indexable, true, kind);
    assert.deepEqual(plan.document.events, [], kind);
    const listed = entries().filter(row => row.path === path);
    assert.equal(listed.length, 1, kind);
    assert.equal(listed[0].lastmod, modified, kind);
  }
});

test("slug-equivalent provider IDs use the latest valid music identity consistently in the page and sitemap", () => {
  for (const latestMatches of [true, false]) {
    const suffix = latestMatches ? "matching" : "mismatched";
    const earlierId = `identity collision ${suffix}`;
    const latestId = `identity-collision-${suffix}`;
    const wrongLocality = { place: "Halifax, Nova Scotia, Canada", city: "Halifax", region: "Nova Scotia" };
    const path = add(`earlier-${suffix}`, { providerId: earlierId, ...(!latestMatches ? {} : wrongLocality) });
    const latestPath = add(`latest-${suffix}`, { providerId: latestId, updatedAt: modified + 1,
      ...(latestMatches ? {} : wrongLocality) });
    assert.equal(latestPath, path);
    add(`nonmusic-${suffix}`, { providerId: earlierId, name: "Not A Music Venue", updatedAt: modified + 2, music: 0 });
    const plan = seoHttpPlan(path);
    assert.equal(plan.type, "document", suffix);
    assert.equal(plan.canonicalPath, path, suffix);
    assert.equal(plan.document.venue.name, "Scotiabank Arena", suffix);
    assert.equal(plan.document.venue.place, latestMatches ? "Toronto, Ontario, Canada" : wrongLocality.place, suffix);
    assert.equal(plan.indexable, latestMatches, suffix);
    const listed = entries().filter(row => row.path === path);
    assert.equal(listed.length, latestMatches ? 1 : 0, suffix);
    if (latestMatches) assert.equal(listed[0].lastmod, modified + 1, suffix);
  }
});
