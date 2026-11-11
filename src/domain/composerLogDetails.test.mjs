import assert from "node:assert/strict";
import test from "node:test";
import { composerLogRequirement, composerRatingDims, hasDetailedComposerRatings, restoredComposerDate } from "./composerLogDetails.mjs";
import { normalizeComposerDraft } from "./composerDraft.mjs";

test("unknown dates survive normalization and restoration without inventing today", () => {
  for (const date of ["", null, undefined]) {
    const draft = normalizeComposerDraft({ postType: "show", artist: "Artist", city: "Toronto", date });
    assert.equal(restoredComposerDate(draft.date), "");
  }
  assert.equal(restoredComposerDate("1994 · 07 · 18"), "1994-07-18");
  assert.equal(restoredComposerDate("2026-02-31"), "2026-02-31", "invalid legacy values remain visible, not reassigned");
});

test("one experience rating never becomes invented band or room dimension scores", () => {
  const dims = composerRatingDims({ overall: 4, band: 4, room: 4, dims: { experience: 4 } });
  assert.deepEqual(dims, { performance: 0, setlist: 0, sound: 0, venue: 0, crowd: 0, experience: 4 });
  assert.equal(hasDetailedComposerRatings(dims), false);
  assert.equal(hasDetailedComposerRatings({ ...dims, performance: 4.5 }), true);
});

test("explicit zeroes remain unrated through edits and legacy scores only fill their own category", () => {
  const dims = composerRatingDims({ overall: 5, band: 5, room: 5, dims: { performance: 0, experience: 4 } });
  assert.equal(dims.performance, 0);
  assert.equal(dims.setlist, 0);
  assert.deepEqual(composerRatingDims({ overall: 4, band: null, room: null }), { performance: 0, setlist: 0, sound: 0, venue: 0, crowd: 0, experience: 4 });
  assert.deepEqual(composerRatingDims({ overall: 4, band: 5, room: 3 }), { performance: 5, setlist: 5, sound: 3, venue: 3, crowd: 0, experience: 4 });
});

test("readiness copy describes the real minimum and distinguishes optional details", () => {
  assert.match(composerLogRequirement(), /artist/);
  assert.match(composerLogRequirement({ artist: "Artist", overall: 4 }), /just the city/);
  assert.match(composerLogRequirement({ artist: "Artist", venue: "Venue", eventAddress: "Public Road", overall: 4 }), /city for the event address/);
  assert.match(composerLogRequirement({ artist: "Artist", city: "Toronto" }), /Share for a memory without ratings/);
  assert.match(composerLogRequirement({ artist: "Artist", city: "Toronto", overall: 4 }), /date, tour, extra ratings and review can stay blank/);
});


test("independent overall and detail edits preserve untouched legacy categories", async () => {
  const { composerReviewRatings } = await import("./composerLogDetails.mjs");
  const editing = { overall: 4.2, band: 4.7, room: null };
  const dims = composerRatingDims(editing);
  const unchanged = composerReviewRatings({ overall: 4.2, dims, computed: { overall: 1, band: 5, room: 5 }, editing });
  assert.equal(unchanged.overall, 4.2);
  assert.equal(unchanged.band, 4.7);
  assert.equal(unchanged.room, null);
  assert.equal(unchanged.dims, undefined);
  const changed = composerReviewRatings({ overall: 2, dims: { ...dims, sound: 5 }, computed: { overall: 5, band: 5, room: 5 }, editing });
  assert.equal(changed.overall, 2);
  assert.equal(changed.band, 4.7);
  assert.equal(changed.room, 5);
  assert.equal(composerReviewRatings({ overall: 0, dims: { performance: 5 }, computed: { overall: 5 } }).overall, 0);
});

test("drafts retain a chosen or deliberately cleared overall and mark older drafts for fallback", () => {
  assert.equal(normalizeComposerDraft({ overallRating: 2, dims: { performance: 5 } }).overallRating, 2);
  assert.equal(normalizeComposerDraft({ overallRating: 0, dims: { experience: 5 } }).overallRating, 0);
  assert.equal(normalizeComposerDraft({ dims: { experience: 5 } }).overallRating, null);
});
