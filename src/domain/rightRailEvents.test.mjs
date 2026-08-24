import assert from "node:assert/strict";
import test from "node:test";
import { RIGHT_RAIL_EVENT_SCOPE, rightRailEventsForScope } from "./rightRailEvents.mjs";

const nearEvents = [
  { id: "near-1", artist: "Local Artist" },
  { id: "near-2", artist: "Nearby Artist" },
];
const worldEvents = [
  { id: "world-1", artist: "World Artist" },
  { id: "world-2", artist: "Touring Artist" },
];

test("right rail Near scope only returns location-ranked discovery events", () => {
  assert.deepEqual(
    rightRailEventsForScope({ scope: RIGHT_RAIL_EVENT_SCOPE.NEAR, nearEvents, worldEvents }),
    nearEvents,
  );
});

test("right rail Near scope stays empty instead of leaking worldwide events", () => {
  assert.deepEqual(
    rightRailEventsForScope({ scope: RIGHT_RAIL_EVENT_SCOPE.NEAR, nearEvents: [], worldEvents }),
    [],
  );
});

test("right rail World scope uses the global upcoming event list and respects its limit", () => {
  assert.deepEqual(
    rightRailEventsForScope({
      scope: RIGHT_RAIL_EVENT_SCOPE.WORLD,
      nearEvents,
      worldEvents,
      limit: 1,
    }),
    [worldEvents[0]],
  );
});

test("right rail event selection is defensive around malformed data and limits", () => {
  assert.deepEqual(rightRailEventsForScope({ nearEvents: null }), []);
  assert.deepEqual(rightRailEventsForScope({ nearEvents, limit: -1 }), []);
  assert.deepEqual(rightRailEventsForScope({ nearEvents, limit: Number.NaN }), nearEvents);
});
