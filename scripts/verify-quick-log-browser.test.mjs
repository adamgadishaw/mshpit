import assert from "node:assert/strict";
import test from "node:test";
import { assertQuickLogPayload } from "./verify-quick-log-browser.mjs";

function quickLog() {
  return {
    artist: "Fixture Artist", venue: "", city: "Toronto, Ontario, Canada", date: "",
    overall: 5, band: null, room: null,
    dims: { performance: 0, setlist: 0, sound: 0, venue: 0, crowd: 0, experience: 5 },
    review: "I remember the music, not the exact date. Fixture only.", tour: "A remembered tour",
  };
}

test("quick-log browser contract accepts an explicitly unknown date and overall-only score", () => {
  assert.doesNotThrow(() => assertQuickLogPayload(quickLog()));
  assert.doesNotThrow(() => assertQuickLogPayload({ ...quickLog(), date: null }));
});

test("quick-log browser contract rejects invented dates and component scores", () => {
  assert.throws(() => assertQuickLogPayload({ ...quickLog(), date: "2026-09-16" }), /unknown date/);
  assert.throws(() => assertQuickLogPayload({ ...quickLog(), band: 5 }), /invent a band score/);
  assert.throws(() => assertQuickLogPayload({ ...quickLog(), room: 0 }), /invent a venue score/);
});

test("quick-log browser contract catches loss of the remembered review during retry", () => {
  assert.throws(() => assertQuickLogPayload({ ...quickLog(), review: "" }));
  assert.throws(() => assertQuickLogPayload({ ...quickLog(), tour: "" }));
});
