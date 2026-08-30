import assert from "node:assert/strict";
import test from "node:test";
import { prepareShowNavigation, showNavigationPostId } from "./showNavigation.mjs";
import { calendarShowFromPost } from "./calendarShows.mjs";
import { publicFramePath } from "./publicFrameNavigation.mjs";

test("provider and artist-created tour dates stay performance events", () => {
  for (const event of [
    { id: "G5v0Z9", source: "ticketmaster", artist: "Alpha", venue: "Arena", date: "2030-01-02" },
    { id: "tour_42", createdBy: "artist-1", artist: "Alpha", venue: "Club", date: "2030-02-03" },
  ]) {
    const navigation = prepareShowNavigation(event);
    assert.equal(navigation.kind, "performance");
    assert.equal(navigation.postId, null);
    assert.equal(navigation.destination.performanceEvent, true);
    assert.equal(showNavigationPostId(navigation.destination), null);
  }
});

test("archive aggregates retain their typed show identity without becoming post URLs", () => {
  const navigation = prepareShowNavigation({
    key: "show.opaque-key",
    artist: "Alpha",
    venue: "Arena",
    place: "Paris, France",
    avgRating: 4.7,
  });
  assert.equal(navigation.kind, "performance");
  assert.equal(navigation.destination.id, "show.opaque-key");
  assert.equal(navigation.destination.archiveShowKey, "show.opaque-key");
  assert.equal(navigation.destination.performanceEvent, true);
  assert.equal(navigation.destination.overall, 4.7);
  assert.equal(navigation.destination.city, "Paris, France");
  assert.equal(showNavigationPostId(navigation.destination), null);
});

test("persisted Pit review posts preserve post navigation and analytics identity", () => {
  const post = { id: "post_42", userId: "fan-1", kind: "review", artist: "Alpha", venue: "Arena" };
  const navigation = prepareShowNavigation(post);
  assert.equal(navigation.kind, "post");
  assert.equal(navigation.destination, post);
  assert.equal(navigation.postId, "post_42");
  assert.equal(showNavigationPostId(post), "post_42");
});

test("an exact archived review opens its concert archive instead of post analytics", () => {
  const navigation = prepareShowNavigation({
    id: "post_42",
    userId: "fan-1",
    kind: "review",
    artist: "Alpha",
    venue: "Arena",
    archiveShowKey: "show.opaque-key",
  });
  assert.equal(navigation.kind, "performance");
  assert.equal(navigation.postId, null);
  assert.equal(navigation.destination.performanceEvent, true);
  assert.equal(showNavigationPostId(navigation.destination), null);
  assert.equal(publicFramePath({ openLog: navigation.destination }), "/concert/show.opaque-key");
});

test("restored performance tags cannot be upgraded into post routes", () => {
  const restored = { id: "post_shaped", userId: "fan-1", kind: "review", performanceEvent: true };
  const navigation = prepareShowNavigation(restored);
  assert.equal(navigation.kind, "performance");
  assert.equal(navigation.postId, null);
  assert.equal(showNavigationPostId(restored), null);
});

test("a Going ticket opens its exact event rather than its surrounding status post", () => {
  const show = calendarShowFromPost({
    id: "post_going_42",
    kind: "status",
    userId: "fan-1",
    attendanceTicket: {
      state: "going",
      tourDateId: "tm_exact_42",
      artist: "Wu-Tang Clan",
      venue: "RBC Amphitheatre",
      city: "Toronto",
      date: "2026-09-08",
      tourName: "Wu-Tang Forever: The Final Chamber",
    },
  });
  const navigation = prepareShowNavigation(show);

  assert.equal(show.id, "tm_exact_42");
  assert.equal(show.postId, "post_going_42");
  assert.equal(show.performanceEvent, true);
  assert.equal(navigation.kind, "performance");
  assert.equal(navigation.destination.id, "tm_exact_42");
  assert.equal(navigation.destination.tourDateId, "tm_exact_42");
  assert.equal(navigation.postId, null);
  assert.equal(showNavigationPostId(navigation.destination), null);
});
