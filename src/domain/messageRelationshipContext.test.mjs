import test from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_MESSAGE_RELATIONSHIP_CONTEXT,
  messageRelationshipChips,
  messageRelationshipSummary,
  normalizeMessageRelationshipContext,
} from "./messageRelationshipContext.mjs";

test("normalizes relationship context and collapses mutual follows into Friends", () => {
  const normalized = normalizeMessageRelationshipContext({
    artist: true,
    friend: true,
    following: true,
    followsYou: true,
    concertBuddy: true,
    sharedShow: {
      artist: "  J. Cole  ",
      venue: " Scotiabank Arena ",
      city: " Toronto ",
      date: "2026-07-27",
      source: "visible_attendance",
    },
  });
  assert.deepEqual(messageRelationshipChips(normalized).map((chip) => chip.label), [
    "Artist",
    "Friends",
    "Concert buddy",
    "Same show",
  ]);
  assert.equal(
    messageRelationshipSummary(normalized),
    "Both logged the same show: J. Cole · Scotiabank Arena · 2026-07-27.",
  );
});

test("copy says logged the same show and never implies a physical encounter", () => {
  const copy = messageRelationshipSummary({
    sharedShow: {
      artist: "IDLES",
      venue: "History",
      date: "2026-09-12",
      source: "public_reviews",
    },
  });
  assert.match(copy, /logged the same show/iu);
  assert.doesNotMatch(copy, /\b(met|together at|went together|saw together)\b/iu);
  assert.equal(messageRelationshipSummary({ concertBuddy: true }), "You're tagged together in a concert post.");
});

test("malformed or self-contradictory server values fail closed", () => {
  assert.equal(normalizeMessageRelationshipContext(null), EMPTY_MESSAGE_RELATIONSHIP_CONTEXT);
  assert.deepEqual(normalizeMessageRelationshipContext({
    friend: true,
    following: true,
    followsYou: false,
    sharedShow: { artist: "J. Cole", venue: "History", date: "sometime" },
  }), {
    artist: false,
    friend: false,
    following: true,
    followsYou: false,
    concertBuddy: false,
    sharedShow: null,
  });
});
