import test from "node:test";
import assert from "node:assert/strict";
import { LIMITS, clean, clampRating } from "./validation.mjs";

test("shared validation strips control and bidi spoofing characters", () => {
  assert.equal(clean("  hello\u0000 \u202Eworld  "), "hello world");
  assert.equal(clean("one\r\n\n\ntwo\t\tthree", { newlines: true }), "one\n\ntwo three");
});

test("shared content limits cover every post reconciliation field", () => {
  assert.deepEqual(
    { artist: LIMITS.artist, venue: LIMITS.venue, city: LIMITS.city, date: LIMITS.date },
    { artist: 80, venue: 80, city: 60, date: 20 },
  );
});

test("shared rating normalization stays bounded to half stars", () => {
  assert.equal(clampRating(4.26), 4.5);
  assert.equal(clampRating(99), 5);
  assert.equal(clampRating("bad"), 0);
});
