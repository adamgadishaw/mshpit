import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const showSource = readFileSync(new URL("../screens/ShowScreen.jsx", import.meta.url), "utf8");
const venuePhotoSource = readFileSync(new URL("../components/VenuePhotoWidget.jsx", import.meta.url), "utf8");

test("the show page uses compact responsive sections and contained review slideshows", () => {
  assert.match(showSource, /function ReviewMediaTile/);
  assert.match(showSource, /const tabletLayout = width >= 720/);
  assert.match(showSource, /archiveReviewTileStyle/);
  assert.match(showSource, /showSummaryWide/);
  assert.match(showSource, /showSummaryMediaColumnWide/);
  assert.match(showSource, /presentation\.showPostEvent && tabletLayout/);
  assert.match(showSource, /archiveReviewGrid/);
  assert.match(showSource, /archiveReviewCardHalf/);
  assert.match(showSource, /archiveReviewCardThird/);
  assert.match(showSource, /heroGridWide/);
  assert.match(showSource, /contain/);
  assert.match(showSource, /!archiveShowKey/);
  assert.match(showSource, />Fan reviews<\/Text>/);
  assert.match(venuePhotoSource, /compact/);
});

test("show timing distinguishes real doors from provider access and attendance has a post-show label", () => {
  assert.match(showSource, /normalizeAttendanceTicketShow/);
  assert.equal(showSource.includes('timing.kind === "doors" ? "DOORS OPEN" : timing.label'), true);
  assert.match(showSource, /attendanceStateDisplayLabel/);
});
