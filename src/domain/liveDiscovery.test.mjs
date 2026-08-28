import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  LIVE_EVENT_SCOPE,
  liveEventLineupLabel,
  liveEventTitle,
  localDiscoveryEvents,
  liveScopeLabel,
  projectPopularLounges,
  projectWorldwideUpcomingEvents,
  upcomingEventsForScope,
} from "./liveDiscovery.mjs";

test("provider-backed festivals and fairs keep their event identity in the UI", () => {
  const festival = {
    artist: "Headliner One",
    eventName: "City Music Festival",
    eventKind: "festival",
    billedArtists: ["Headliner One", "Headliner Two", "Headliner Three", "Headliner Four"],
  };
  assert.equal(liveEventTitle(festival), "City Music Festival");
  assert.equal(liveEventLineupLabel(festival), "Headliner One · Headliner Two · Headliner Three +1");
  assert.equal(liveEventTitle({ artist: "Solo Act", eventName: "Solo Act Live", eventKind: "concert" }), "Solo Act");
  assert.equal(liveEventTitle({}), "Event to be announced");
});

test("the in-app event detail preserves event title, lineup, and date range presentation", () => {
  const source = readFileSync(new URL("../screens/ShowScreen.jsx", import.meta.url), "utf8");
  assert.match(source, /const eventTitle = liveEventTitle\(norm\)/);
  assert.match(source, /title=\{eventTitle\}/);
  assert.match(source, /LINEUP · \{eventLineup\}/);
  assert.match(source, /formatDate\(eventEndDate, eventEndDate\)/);
  assert.match(source, /onReview\?\.\(norm\)/, "event presentation must preserve the existing exact-show review payload");
});

test("upcoming event scope never substitutes worldwide rows into an empty local view", () => {
  const worldwide = [{ id: "world", artist: "World Artist" }];
  assert.deepEqual(upcomingEventsForScope({ localEvents: [], worldwideEvents: worldwide }), []);
  assert.deepEqual(upcomingEventsForScope({
    scope: LIVE_EVENT_SCOPE.WORLDWIDE,
    localEvents: [{ id: "local" }],
    worldwideEvents: worldwide,
  }), worldwide);
});

test("upcoming event scope deduplicates and bounds cards", () => {
  const rows = [{ id: "one" }, { id: "one" }, { id: "two" }, null];
  assert.deepEqual(upcomingEventsForScope({ worldwideEvents: rows, scope: LIVE_EVENT_SCOPE.WORLDWIDE, limit: 1 }), [rows[0]]);
  assert.deepEqual(upcomingEventsForScope({ worldwideEvents: rows, scope: LIVE_EVENT_SCOPE.WORLDWIDE, limit: -1 }), []);
});

test("active multi-day events stay pinned ahead of future concerts", () => {
  const now = new Date(2026, 7, 27, 12).getTime();
  const rows = [
    { id: "future", date: "2026-08-28", releaseAt: 0 },
    { id: "active", date: "2026-08-21", eventEndDate: "2026-09-07", releaseAt: 0 },
  ];
  assert.deepEqual(projectWorldwideUpcomingEvents(rows, { now }).map((event) => event.id), ["active", "future"]);
});

test("saved-area discovery excludes globally widened rows from the Local scope", () => {
  const rows = [
    { id: "city", local: true },
    { id: "worldwide-fallback", local: false },
    { id: "unranked" },
  ];
  assert.deepEqual(localDiscoveryEvents(rows), [rows[0]]);
});

test("worldwide discovery scans once into a bounded chronological projection", () => {
  const now = new Date(2026, 7, 27, 12).getTime();
  const rows = [
    { id: "later", date: "2026-09-02", releaseAt: 0 },
    { id: "past", date: "2026-08-26", releaseAt: 0 },
    { id: "soon", date: "2026-08-28", releaseAt: 0 },
    { id: "embargoed", date: "2026-08-29", releaseAt: now + 1 },
    { id: "same-day", date: "2026-08-28", releaseAt: 0 },
  ];
  const projected = projectWorldwideUpcomingEvents(rows, { limit: 2, now });
  assert.deepEqual(projected.map((event) => event.id), ["soon", "same-day"]);
  assert.notEqual(projected[0], rows[2], "the bounded public projection should not expose mutable catalogue rows");
  assert.equal(rows.length, 5, "projection must not mutate the source catalogue");
});

test("worldwide discovery rejects malformed inputs and empty bounds", () => {
  assert.deepEqual(projectWorldwideUpcomingEvents(null), []);
  assert.deepEqual(projectWorldwideUpcomingEvents([{ date: "not-a-date", releaseAt: 0 }]), []);
  assert.deepEqual(projectWorldwideUpcomingEvents([{ date: "2027-01-01", releaseAt: 0 }], { limit: 0 }), []);
});

test("popular lounge projection exposes aggregate show metadata only", () => {
  const rows = projectPopularLounges([
    { key: "band|room|2026-09-01", artist: "Band", venue: "Room", city: "Toronto", date: "2026-09-01", message_count: 8, attendee_count: 3, last_activity_at: 20, text: "private chat", userId: "fan-1", home_city: "Secret" },
    { key: "quiet|room|2026-09-02", artist: "Quiet", venue: "Room", messageCount: 0, attendeeCount: 9 },
  ]);
  assert.deepEqual(rows, [{
    key: "band|room|2026-09-01",
    artist: "Band",
    venue: "Room",
    city: "Toronto",
    place: "Toronto",
    date: "2026-09-01",
    messageCount: 8,
    attendeeCount: 3,
    lastActivityAt: 20,
  }]);
  assert.equal("text" in rows[0], false);
  assert.equal("userId" in rows[0], false);
  assert.equal("home_city" in rows[0], false);
});

test("scope labels identify saved-area and worldwide discovery honestly", () => {
  assert.equal(liveScopeLabel({ scope: LIVE_EVENT_SCOPE.LOCAL, homeCity: "Toronto" }), "Near Toronto");
  assert.equal(liveScopeLabel({ scope: LIVE_EVENT_SCOPE.LOCAL }), "Near you");
  assert.equal(liveScopeLabel({ scope: LIVE_EVENT_SCOPE.WORLDWIDE, homeCity: "Toronto" }), "Worldwide");
});
