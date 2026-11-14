import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const showSource = readFileSync(new URL("../screens/ShowScreen.jsx", import.meta.url), "utf8");
const venuePhotoSource = readFileSync(new URL("../components/VenuePhotoWidget.jsx", import.meta.url), "utf8");

test("the show page uses compact responsive sections and contained review slideshows", () => {
  assert.match(showSource, /function ReviewMediaTile/);
  assert.match(showSource, /const tabletLayout = concertDetailWide\(width, fontScale, Platform\.OS, 720\)/);
  assert.match(showSource, /archiveReviewTileStyle/);
  assert.match(showSource, /overviewWide/);
  assert.match(showSource, /overviewPhotosWide/);
  assert.match(showSource, /archiveReviewGrid/);
  assert.match(showSource, /archiveReviewCardFull/);
  assert.match(showSource, /title="Event details"/);
  assert.match(showSource, /contain/);
  assert.match(showSource, /!archiveShowKey/);
  assert.match(showSource, /title="Reviews" initiallyOpen/);
  assert.match(venuePhotoSource, /compact/);
});

test("show timing distinguishes real doors from provider access and attendance has a post-show label", () => {
  assert.match(showSource, /normalizeAttendanceTicketShow/);
  assert.equal(showSource.includes('timing.kind === "doors" ? "DOORS OPEN" : timing.label'), true);
  assert.match(showSource, /attendanceStateDisplayLabel/);
});
