import test from "node:test";
import assert from "node:assert/strict";
import { iosBackGestureAllowed, iosBackSwipeCommits } from "./iosNavigationPolicy.mjs";
test("iOS edge Back permits read-only details and never silently dismisses editors or media", () => {
  for (const key of ["profileId", "venueName", "news", "calendar"]) assert.equal(iosBackGestureAllowed({ [key]: true }), true);
  for (const key of ["artistName", "post", "openLog", "festival", "photos", "logging", "editingPost", "auth", "editProfile", "newsroom", "settings", "thread", "reporting", "ownerApproval"]) {
    assert.equal(iosBackGestureAllowed({ [key]: true }), false);
    assert.equal(iosBackGestureAllowed({ profileId: "Member", [key]: true }), false);
  }
  for (const frame of [null, {}, [], { unknown: true }]) assert.equal(iosBackGestureAllowed(frame), false);
});
test("iOS edge Back needs deliberate rightward release, not vertical scroll or canceled gesture", () => {
  const input = { dx: 120, dy: 5, width: 390 };
  assert.equal(iosBackSwipeCommits(input), true);
  for (const patch of [{ dx: -150 }, { dx: 50 }, { dy: 90 }, { canceled: true }, { dx: NaN }]) assert.equal(iosBackSwipeCommits({ ...input, ...patch }), false);
});
