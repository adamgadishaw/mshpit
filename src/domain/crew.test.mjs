import assert from "node:assert/strict";
import test from "node:test";

import { CREW_PURPOSES, crewCountLabel, crewDateLabel, crewPurposeLabels } from "./crew.mjs";
import { notificationBundleKey } from "./notification-bundles.mjs";
import { isReservedSlug } from "./urls.mjs";

test("purpose labels ignore unknown ids, repeats and anything past four", () => {
  assert.deepEqual(crewPurposeLabels(["ride", "ride", "nope", "hotel"]), ["Share a ride", "Split a hotel"]);
  assert.equal(crewPurposeLabels(Object.keys(CREW_PURPOSES)).length, 4);
  assert.deepEqual(crewPurposeLabels("ride"), []);
});

test("show dates read as the venue's calendar day, never shifted by time zone", () => {
  assert.equal(crewDateLabel("2026-10-10", { today: "2026-10-10" }), "Tonight · Oct 10");
  assert.equal(crewDateLabel("2026-10-11", { today: "2026-10-10" }), "Tomorrow · Oct 11");
  assert.equal(crewDateLabel("2026-10-16", { today: "2026-10-10" }), "Fri · Oct 16");
  assert.equal(crewDateLabel("2027-01-02", { today: "2026-10-10" }), "Sat · Jan 2, 2027");
  assert.equal(crewDateLabel("2026-10-16", { short: true }), "Oct 16");
  assert.equal(crewDateLabel("2026-02-31"), "", "impossible dates stay blank");
  assert.equal(crewDateLabel(null), "");
});

test("counts read naturally and never go negative", () => {
  assert.equal(crewCountLabel(0, "going"), "Be the first going");
  assert.equal(crewCountLabel(12, "going"), "12 going");
  assert.equal(crewCountLabel(3, "crew"), "3 looking for a crew");
  assert.equal(crewCountLabel(1, "others"), "1 other looking");
  assert.equal(crewCountLabel(-4, "others"), "0 others looking");
});

test("each crew notification stays its own row and /crew is never an artist slug", () => {
  const a = notificationBundleKey({ id: "n1", type: "crew_match", actorId: "u_a", postId: "tm_1" });
  const b = notificationBundleKey({ id: "n2", type: "crew_match", actorId: "u_b", postId: "tm_1" });
  assert.notEqual(a, b);
  assert.equal(isReservedSlug("crew"), true);
});
