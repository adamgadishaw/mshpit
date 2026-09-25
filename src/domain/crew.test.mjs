import assert from "node:assert/strict";
import test from "node:test";

import { crewDateLabel, goingLabel } from "./crew.mjs";
import { PLAN_KINDS, planKindLabel, planSpotsLabel } from "./showPlans.mjs";
import { notificationBundleKey } from "./notification-bundles.mjs";
import { notificationDestination } from "./notificationDeepLink.mjs";

test("show dates read as the venue's calendar day, never shifted by time zone", () => {
  assert.equal(crewDateLabel("2026-10-10", { today: "2026-10-10" }), "Tonight · Oct 10");
  assert.equal(crewDateLabel("2026-10-11", { today: "2026-10-10" }), "Tomorrow · Oct 11");
  assert.equal(crewDateLabel("2026-10-16", { today: "2026-10-10" }), "Fri · Oct 16");
  assert.equal(crewDateLabel("2027-01-02", { today: "2026-10-10" }), "Sat · Jan 2, 2027");
  assert.equal(crewDateLabel("2026-10-16", { short: true }), "Oct 16");
  assert.equal(crewDateLabel("2026-02-31"), "", "impossible dates stay blank");
  assert.equal(crewDateLabel(null), "");
});

test("going counts read naturally and never go negative", () => {
  assert.equal(goingLabel(0), "Be the first going");
  assert.equal(goingLabel(12), "12 going");
  assert.equal(goingLabel(-3), "Be the first going");
});

test("plan labels fall back safely", () => {
  assert.equal(planKindLabel("ride"), "Share a ride");
  assert.equal(planKindLabel("bogus"), PLAN_KINDS.other);
  assert.equal(planSpotsLabel(1, 3), "1 of 3 spots taken");
  assert.equal(planSpotsLabel(1, 1), "Full");
  assert.equal(planSpotsLabel(0, 1), "0 of 1 spot taken");
});

test("a plan join opens your plans and each plan keeps its own notification row", () => {
  assert.deepEqual(notificationDestination({ type: "plan_join", actorId: "u_a", postId: "plan_1" }), { kind: "plans" });
  const a = notificationBundleKey({ id: "n1", type: "plan_join", actorId: "u_a", postId: "plan_1" });
  const b = notificationBundleKey({ id: "n2", type: "plan_join", actorId: "u_b", postId: "plan_2" });
  assert.notEqual(a, b);
});
