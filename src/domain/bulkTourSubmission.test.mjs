import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import { createBulkTourSubmissionLifecycle, scheduledTourRelease } from "./bulkTourSubmission.mjs";

test("scheduled tour releases must be strictly in the future", () => {
  const today = new Date(2026, 7, 21, 12).getTime();
  assert.deepEqual(scheduledTourRelease("2026-08-20", { now: today }), {
    ok: false, releaseAt: 0, error: "Choose a future release date.",
  });
  assert.equal(scheduledTourRelease("2026-08-21", { now: today }).ok, false);
  assert.equal(scheduledTourRelease("2026-08-22", { now: today }).ok, true);
});

test("submission lifecycle rejects completions after edit or unmount", () => {
  const lifecycle = createBulkTourSubmissionLifecycle();
  const first = lifecycle.begin();
  assert.equal(lifecycle.isCurrent(first), true);
  lifecycle.invalidate();
  assert.equal(lifecycle.isCurrent(first), false);
  const second = lifecycle.begin();
  lifecycle.unmount();
  assert.equal(lifecycle.isCurrent(second), false);
  lifecycle.mount();
  const remounted = lifecycle.begin();
  assert.equal(lifecycle.isCurrent(remounted), true);
});

test("Bulk Tour JSX locks saving controls and owns its delayed-close cleanup", () => {
  const source = readFileSync(new URL("../screens/BulkTourDatesScreen.jsx", import.meta.url), "utf8");
  assert.doesNotThrow(() => parse(source, { sourceType: "module", plugins: ["jsx"] }));
  assert.match(source, /leadDisabled=\{saving\}/);
  assert.match(source, /editable=\{!formLocked/);
  assert.match(source, /lifecycleRef\.current\.isCurrent\(submission\)/);
  assert.match(source, /clearTimeout\(closeTimerRef\.current\)/);
});
