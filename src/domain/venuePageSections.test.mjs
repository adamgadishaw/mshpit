import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";

import {
  VENUE_PAGE_SECTIONS,
  normalizeVenuePageSection,
  venuePagePreview,
  venuePageSectionModel,
  venuePhotoViewerIndex,
} from "./venuePageSections.mjs";

const venueScreen = readFileSync(new URL("../screens/VenueScreen.jsx", import.meta.url), "utf8");

test("venue page sections keep one compact overview and explicit full sections", () => {
  assert.deepEqual(VENUE_PAGE_SECTIONS.map(({ key }) => key), ["overview", "shows", "reviews"]);
  assert.equal(normalizeVenuePageSection("SHOWS"), "shows");
  assert.equal(normalizeVenuePageSection("unknown"), "overview");

  const overview = venuePageSectionModel("overview");
  assert.equal(overview.condensed, true);
  assert.equal(overview.showGuide, true);
  assert.equal(overview.showUpcoming, true);
  assert.equal(overview.showReviews, true);
  assert.equal(overview.showHistory, false);

  const shows = venuePageSectionModel("shows");
  assert.equal(shows.condensed, false);
  assert.equal(shows.showUpcoming, true);
  assert.equal(shows.showGuide, false);
  assert.equal(shows.showHistory, true);
  assert.equal(shows.showReviews, false);

  const reviews = venuePageSectionModel("reviews");
  assert.equal(reviews.showUpcoming, false);
  assert.equal(reviews.showReputation, true);
  assert.equal(reviews.showPhotos, true);
  assert.equal(reviews.showReviews, true);
});

test("venue overview projections are bounded without mutating full collections", () => {
  const rows = [1, 2, 3, 4, 5];
  assert.deepEqual(venuePagePreview(rows, { condensed: true, limit: 2 }), [1, 2]);
  assert.strictEqual(venuePagePreview(rows), rows);
  assert.deepEqual(venuePagePreview(null, { condensed: true }), []);
});

test("venue photo previews open the matching item in the complete gallery", () => {
  const first = { uri: "https://images.example/first.jpg" };
  const failed = { uri: "https://images.example/failed.jpg" };
  const current = { uri: "https://images.example/current.jpg" };
  const photos = [first, failed, current];

  assert.equal(venuePhotoViewerIndex(photos, current, 1), 2);
  assert.equal(venuePhotoViewerIndex(photos, { uri: current.uri }, 0), 2);
  assert.equal(venuePhotoViewerIndex(photos, { uri: "https://images.example/missing.jpg" }, 99), 2);
  assert.equal(venuePhotoViewerIndex([], current, 4), 0);
});

test("venue screen renders bounded previews instead of every show at once", () => {
  assert.doesNotThrow(() => parse(venueScreen, { sourceType: "module", plugins: ["jsx"] }));
  assert.match(venueScreen, /<VenuePageSectionNav active=\{activeSection\} onChange=\{setActiveSection\} \/>/);
  assert.match(venueScreen, /sectionModel\.showGuide/);
  assert.match(venueScreen, /<VenueVisitGuide/);
  assert.match(venueScreen, /venuePagePreview\(upcomingWindow\.rows, \{ condensed: sectionModel\.condensed, limit: 3 \}\)/);
  assert.match(venueScreen, /venuePagePreview\(reviewWindow\.rows, \{ condensed: sectionModel\.condensed, limit: 2 \}\)/);
  assert.match(venueScreen, /visibleUpcoming\.map\(\(event\) =>/);
  assert.doesNotMatch(venueScreen, /venue\.upcoming\.map\(\(event\) =>/);
  assert.match(venueScreen, /venuePagePreview\(fullGridPhotos, \{ condensed: true, limit: 3 \}\)/);
  assert.match(venueScreen, /onOpenPhotos\?\.\(fullGridPhotos, index\)/);
  assert.match(venueScreen, /See all \$\{fullGridPhotos\.length\} fan photos/);
  assert.match(venueScreen, /reviewPhotoViewerItems\.slice\(0, 3\)/);
  assert.match(venueScreen, /onOpenPhotos\?\.\(reviewPhotoViewerItems, index\)/);
  assert.match(venueScreen, /renderText=\{\(\{ text, accessibilityLabel \}\) =>/);
  assert.match(venueScreen, /venuePhotoViewerIndex\(photos, photo, fallbackIndex\)/);
  assert.match(venueScreen, /sectionModel\.showHistory/);
  assert.match(venueScreen, /accessibilityRole="tab"/);
});
