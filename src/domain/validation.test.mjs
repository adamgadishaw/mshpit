import test from "node:test";
import assert from "node:assert/strict";
import { LIMITS, clean, clampRating } from "./validation.mjs";

test("shared validation strips control and bidi spoofing characters", () => {
  assert.equal(clean("  hello\u0000 \u202Eworld  "), "hello world");
  assert.equal(clean("one\r\n\n\ntwo\t\tthree", { newlines: true }), "one\n\ntwo three");
});

test("shared content limits cover every post reconciliation field", () => {
  assert.deepEqual(
    { artist: LIMITS.artist, venue: LIMITS.venue, city: LIMITS.city, eventAddress: LIMITS.eventAddress, date: LIMITS.date },
    { artist: 80, venue: 80, city: 240, eventAddress: 240, date: 20 },
  );
});

test("shared rating normalization stays bounded to half stars", () => {
  assert.equal(clampRating(4.26), 4.5);
  assert.equal(clampRating(99), 5);
  assert.equal(clampRating("bad"), 0);
});



test("review counters measure server-normalized UTF-16 units before the limit", async () => {
  const { normalizeReviewText, reviewTextLength } = await import("./validation.mjs");
  for (const input of ["  one\r\n\n\ntwo\t\tthree\u200b\u202e  ", "e\u0301", "\u{1F600}", "\u{1F469}\u200d\u{1F3A4}"]) {
    assert.equal(normalizeReviewText(input), clean(input, { max: Infinity, newlines: true }));
    assert.equal(reviewTextLength(input), clean(input, { max: Infinity, newlines: true }).length);
  }
  assert.equal(reviewTextLength("\u{1F600}"), 2);
  assert.equal(reviewTextLength("x".repeat(1998) + "\u{1F600}"), 2000);
  assert.equal(reviewTextLength("x".repeat(1999) + "\u{1F600}"), 2001);
  assert.equal(normalizeReviewText("x".repeat(2001)).length, 2001, "measurement must never truncate the draft");
});

test("concert review ceiling allows ordinary 2,000-word prose without changing other scopes", async () => {
  const { twoThousandWordReview } = await import("../../scripts/fixtures/concert-review-text.mjs");
  const { normalizeReviewText, reviewTextLength } = await import("./validation.mjs");
  assert.equal(LIMITS.concertReview, 32000);
  assert.equal(LIMITS.review, 2000);
  assert.equal(twoThousandWordReview.split(/\s+/u).length, 2000);
  assert.ok(reviewTextLength(twoThousandWordReview) < LIMITS.concertReview);
  assert.equal(reviewTextLength("x".repeat(LIMITS.concertReview - 2) + "😀"), LIMITS.concertReview);
  assert.equal(reviewTextLength("x".repeat(LIMITS.concertReview - 1) + "😀"), LIMITS.concertReview + 1);
  assert.equal(normalizeReviewText("x".repeat(LIMITS.concertReview + 1)).length, LIMITS.concertReview + 1);
});
