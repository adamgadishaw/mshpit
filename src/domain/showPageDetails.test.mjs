import test from "node:test";
import assert from "node:assert/strict";
import { savedShowRating, showPageRating, showPageEventArtwork } from "./showPageDetails.mjs";

test("overall show scores are saved values, never inferred from artist, venue or dimensions", () => {
  assert.equal(showPageRating({ band: 5, room: 1, dims: { performance: 5, venue: 1 } }).overall, null);
  assert.equal(showPageRating({ overall: 3.2, band: 5, room: 1 }).overall, 3.2);
  for (const value of [null, undefined, 0, -1, 6, NaN, Infinity, true, "4.5"]) assert.equal(savedShowRating(value), null);
});

test("rating counts never come from reactions or review excerpts", () => {
  assert.equal(showPageRating({ overall: 4, likes: 25, comments: 8, reviewCount: 6 }).countLabel, null);
  assert.equal(showPageRating({ overall: 4, ratingCount: 1 }).countLabel, "1 rating");
  assert.equal(showPageRating({ overall: 4, ratingCount: 27, reviewCount: 2 }).countLabel, "27 ratings");
  for (const count of [-1, 1.5, true, "2"]) assert.equal(showPageRating({ ratingCount: count }).countLabel, null);
});

test("an individual review is never presented as a community rating", () => {
  const post = { id: "review", userId: "fan", user: { name: "Alex" }, overall: 4.5, ratingCount: 10 };
  assert.equal(showPageRating(post).label, "Alex's overall show rating");
  assert.equal(showPageRating(post).countLabel, null);
  assert.equal(showPageRating({ ...post, archiveShowKey: "exact-night" }).label, "Overall show rating");
});

test("event artwork needs the existing provider attribution contract and cannot promote attachments", () => {
  const eventImage = { uri: "https://images.example.test/event.jpg", attribution: "Event promoter", sourcePage: "https://www.ticketmaster.com/event/fixture", width: 1000, height: 600 };
  assert.equal(showPageEventArtwork({ source: "ticketmaster", eventImage }).by, "Event promoter");
  for (const patch of [{ attribution: null }, { sourcePage: null }, { width: 0 }, { public: false }, { uri: "javascript:alert(1)" }]) {
    assert.equal(showPageEventArtwork({ source: "ticketmaster", eventImage: { ...eventImage, ...patch } }), null);
  }
  assert.equal(showPageEventArtwork({ photos: [eventImage.uri], photosPublic: false }), null);
  assert.equal(showPageEventArtwork({ source: "unknown", eventImage }), null);
});
