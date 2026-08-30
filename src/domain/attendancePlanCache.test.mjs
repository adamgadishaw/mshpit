import assert from "node:assert/strict";
import test from "node:test";

import { reconcileAttendancePlan } from "./attendancePlanCache.mjs";

const show = {
  id: "show_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  canonicalKey: "artist|venue|2026-09-16",
  tourDateId: "tm-16",
  artist: "Artist",
  venue: "Venue",
  city: "Toronto",
  date: "2026-09-16",
};

test("Interested persists in canonical planning rows and removes stale legacy Going", () => {
  const current = [{ key: show.canonicalKey, tourDateId: show.tourDateId, artist: show.artist, venue: show.venue, date: show.date }];
  const next = reconcileAttendancePlan({
    attendanceRows: [],
    goingRows: current,
    show,
    result: {
      showId: show.id,
      attendance: { showId: show.id, state: "interested", visibility: "members", verified: false },
    },
    now: 123,
  });
  assert.equal(next.attendanceRows[0].state, "interested");
  assert.equal(next.attendanceRows[0].tourDateId, "tm-16");
  assert.deepEqual(next.goingRows, []);
});

test("Going updates both canonical and legacy projections while clear removes both", () => {
  const going = reconcileAttendancePlan({
    attendanceRows: [], goingRows: [], show,
    result: { showId: show.id, attendance: { showId: show.id, state: "going", visibility: "followers" } },
    now: 200,
  });
  assert.equal(going.attendanceRows[0].state, "going");
  assert.equal(going.goingRows.length, 1);
  assert.equal(going.goingRows[0].tourDateId, "tm-16");

  const cleared = reconcileAttendancePlan({
    attendanceRows: going.attendanceRows,
    goingRows: going.goingRows,
    show,
    result: { showId: show.id, attendance: null },
    now: 300,
  });
  assert.deepEqual(cleared.attendanceRows, []);
  assert.deepEqual(cleared.goingRows, []);
});
