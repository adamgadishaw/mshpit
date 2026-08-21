import assert from "node:assert/strict";
import test from "node:test";
import { attendanceTotalForView, normalizeAttendanceSnapshot } from "./showAttendance.mjs";

test("attendance snapshot keeps the authoritative total beyond the bounded page", () => {
  const snapshot = normalizeAttendanceSnapshot({ attendees: [{ id: "1" }, { id: "2" }], total: 205, nextCursor: "next" });
  assert.equal(snapshot.total, 205);
  assert.equal(snapshot.nextCursor, "next");
});

test("optimistic viewer intent adjusts the server total without dropping visible rows", () => {
  assert.equal(attendanceTotalForView({ total: 205, serverViewerGoing: false, viewerGoing: true, visibleCount: 30 }), 206);
  assert.equal(attendanceTotalForView({ total: 205, serverViewerGoing: true, viewerGoing: false, visibleCount: 30 }), 204);
  assert.equal(attendanceTotalForView({ total: 0, serverViewerGoing: false, viewerGoing: false, visibleCount: 2 }), 2);
});
