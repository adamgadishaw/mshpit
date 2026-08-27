import assert from "node:assert/strict";
import test from "node:test";
import {
  RIGHT_RAIL_EVENT_SCOPE,
  reconcileRightRailScopeChoice,
  rightRailEventsForScope,
  rightRailScopeIdentity,
} from "./rightRailEvents.mjs";

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

test("right rail scope identity is account and home-area scoped", () => {
  assert.equal(
    rightRailScopeIdentity({ accountId: "User-1", homeCity: " New   York " }),
    "user-1::new york",
  );
  assert.notEqual(
    rightRailScopeIdentity({ accountId: "user-1", homeCity: "Toronto" }),
    rightRailScopeIdentity({ accountId: "user-2", homeCity: "Toronto" }),
  );
});

test("right rail preserves a deliberate scope choice only within one account and home area", () => {
  const localContext = { accountId: "user-1", homeCity: "Toronto" };
  const initial = reconcileRightRailScopeChoice(null, localContext);
  assert.deepEqual(initial, {
    identity: "user-1::toronto",
    value: RIGHT_RAIL_EVENT_SCOPE.NEAR,
    touched: false,
  });

  const chosenWorld = { ...initial, value: RIGHT_RAIL_EVENT_SCOPE.WORLD, touched: true };
  assert.deepEqual(reconcileRightRailScopeChoice(chosenWorld, localContext), chosenWorld);

  assert.deepEqual(
    reconcileRightRailScopeChoice(chosenWorld, { accountId: "user-1", homeCity: "" }),
    {
      identity: "user-1::world",
      value: RIGHT_RAIL_EVENT_SCOPE.WORLD,
      touched: false,
    },
  );
  assert.deepEqual(
    reconcileRightRailScopeChoice(chosenWorld, { accountId: "user-2", homeCity: "Toronto" }),
    {
      identity: "user-2::toronto",
      value: RIGHT_RAIL_EVENT_SCOPE.NEAR,
      touched: false,
    },
  );
});
