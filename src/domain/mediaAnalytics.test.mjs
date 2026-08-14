import assert from "node:assert/strict";
import test from "node:test";

import { pendingVideoMilestones } from "./mediaAnalytics.mjs";

test("video milestones cross each threshold once and reserve completion for the end event", () => {
  assert.deepEqual(pendingVideoMilestones({ currentTime: 51, duration: 100 }), ["25", "50"]);
  assert.deepEqual(pendingVideoMilestones({ currentTime: 99.9, duration: 100, seen: new Set(["25", "50"]) }), ["75"]);
  assert.deepEqual(pendingVideoMilestones({ currentTime: 100, duration: 100, seen: ["25", "50", "75"], ended: true }), ["100"]);
});

test("video milestones ignore invalid durations and never duplicate recorded progress", () => {
  assert.deepEqual(pendingVideoMilestones({ currentTime: 30, duration: 0 }), []);
  assert.deepEqual(pendingVideoMilestones({ currentTime: 80, duration: 100, seen: new Set(["25", "50", "75"]) }), []);
  assert.deepEqual(pendingVideoMilestones({ ended: true, seen: ["100"] }), []);
});
