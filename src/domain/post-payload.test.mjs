import test from "node:test";
import assert from "node:assert/strict";

import { buildReviewCreateBody, buildReviewEditBody } from "./post-payload.mjs";

test("a selected J. Cole catalog key survives the review create payload", () => {
  const body = buildReviewCreateBody({
    id: "post_jcole_retry_001",
    artist: "J. Cole",
    artistKey: "j. cole",
    venue: "Scotiabank Arena",
    city: "Toronto",
    date: "2026-07-27",
    overall: 5,
    band: 5,
    room: 4.5,
    dims: { performance: 5 },
    review: "Toronto night one",
    photos: [],
    photosPublic: true,
    landingShowcase: true,
    setlist: [],
    tags: ["final tour"],
  });

  assert.equal(body.artist, "J. Cole");
  assert.equal(body.clientMutationId, "post_jcole_retry_001");
  assert.equal(body.artistKey, "j. cole");
  assert.equal(body.venue, "Scotiabank Arena");
  assert.equal(body.date, "2026-07-27");
  assert.equal(body.landingShowcase, 1);
});

test("review payloads never feature photos that are not public", () => {
  assert.equal(buildReviewCreateBody({ id: "post_private_001", photosPublic: false, landingShowcase: true }).landingShowcase, 0);
  assert.equal(buildReviewEditBody({ photosPublic: false, landingShowcase: true }).landingShowcase, false);
});

test("review edits sanitize and explicitly send the selected artist key", () => {
  const body = buildReviewEditBody({
    artist: "  J. Cole  ",
    artistKey: `  j. cole\u0000${"x".repeat(140)}  `,
    venue: "  Scotiabank Arena  ",
    city: " Toronto ",
    date: "2026-07-27",
    overall: 5,
  });

  assert.equal(body.artist, "J. Cole");
  assert.equal(body.artistKey.startsWith("j. colex"), true);
  assert.equal(body.artistKey.length, 120);
  assert.equal(body.venue, "Scotiabank Arena");
  assert.equal(body.city, "Toronto");
  assert.equal(Object.prototype.hasOwnProperty.call(body, "artistKey"), true);
  assert.equal(buildReviewEditBody({ artist: "Local act", artistKey: null }).artistKey, null);
});
