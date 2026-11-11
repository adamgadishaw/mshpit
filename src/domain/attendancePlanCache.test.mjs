import assert from "node:assert/strict";
import test from "node:test";

import { attendancePlanDetails, hydrateAttendanceGoingRows, reconcileAttendancePlan, replaceGoingPlan } from "./attendancePlanCache.mjs";

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

const early = {
  ...show, showId: show.id, key: show.canonicalKey,
  startDateTime: "2026-09-16T23:00:00Z", startLocalTime: "19:00", eventTimezone: "America/Toronto",
  eventEndDate: "2026-09-17", providerEventId: "early-provider-id", source: "ticketmaster",
};
const late = { ...early, id: "show_late", showId: "show_late", tourDateId: "tm-late", startDateTime: "2026-09-17T02:00:00Z", startLocalTime: "22:00" };
const legacy = { key: show.canonicalKey, artist: show.artist, venue: show.venue, date: show.date, city: show.city };
const attendance = (row, state = "going", visibility = "private") => ({ ...row, state, visibility });

test("same-night performances with explicit ids remain separate when one changes or clears", () => {
  for (const state of ["interested", "going", null]) {
    const result = reconcileAttendancePlan({
      attendanceRows: [attendance(early), attendance(late, "going", "followers")],
      goingRows: [early, late], show: early,
      result: { showId: early.showId, attendance: state ? { state, visibility: "private" } : null },
    });
    assert.deepEqual(result.attendanceRows.find((row) => row.showId === late.showId), attendance(late, "going", "followers"));
    assert.deepEqual(result.goingRows.find((row) => row.showId === late.showId), late);
    assert.equal(result.attendanceRows.filter((row) => row.showId === early.showId).length, state ? 1 : 0);
    assert.equal(result.goingRows.filter((row) => row.showId === early.showId).length, state === "going" ? 1 : 0);
  }
});

test("an equal display key never overrides conflicting show or catalog ids", () => {
  assert.deepEqual(replaceGoingPlan([early, late], early, false), [late]);
  const conflictingCatalog = { ...early, tourDateId: "different-catalog-id" };
  assert.deepEqual(replaceGoingPlan([conflictingCatalog], early, false), [conflictingCatalog]);
  const catalogOnly = { ...legacy, tourDateId: early.tourDateId };
  const showOnly = { ...legacy, showId: early.showId };
  assert.deepEqual(replaceGoingPlan([catalogOnly], showOnly, false), [catalogOnly], "disjoint exact namespaces do not prove a match");
  assert.deepEqual(replaceGoingPlan([catalogOnly, showOnly], early, false), [], "a row linking both exact ids proves a match");
});

test("an exact performance can update its schedule without creating a duplicate", () => {
  const rescheduled = { ...early, date: "2026-09-18", startLocalTime: "20:00", startDateTime: "2026-09-19T00:00:00Z" };
  assert.deepEqual(replaceGoingPlan([early], rescheduled, true), [rescheduled]);
});

test("legacy rows upgrade only when their known candidates identify one performance", () => {
  assert.deepEqual(replaceGoingPlan([legacy], early, true), [early]);
  assert.deepEqual(replaceGoingPlan([legacy, late], early, false), [legacy, late]);
  const legacyEarly = { ...legacy, startLocalTime: "7:00 PM", eventTimezone: "America/Toronto" };
  assert.deepEqual(replaceGoingPlan([legacyEarly, late], early, false), [late]);
  const otherCity = { ...legacy, city: "Vancouver" };
  assert.deepEqual(replaceGoingPlan([otherCity], early, false), [otherCity]);
});

test("ambiguous legacy attendance cannot transfer its visibility to an exact performance", () => {
  const oldPlan = attendance(legacy, "going", "everyone");
  const result = reconcileAttendancePlan({
    attendanceRows: [oldPlan, attendance(late)], goingRows: [legacy, late], show: early,
    result: { showId: early.showId, attendance: { state: "interested" } },
  });
  assert.deepEqual(result.attendanceRows[0], oldPlan);
  assert.equal(result.attendanceRows.find((row) => row.showId === early.showId).visibility, "private");
  assert.deepEqual(result.goingRows, [legacy, late]);
});

test("hydration retains both exact performances and conservatively retains an ambiguous legacy row", () => {
  const rows = hydrateAttendanceGoingRows([legacy], [attendance(early), attendance(late)]);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], legacy);
  assert.deepEqual(rows.map((row) => row.tourDateId), [undefined, early.tourDateId, late.tourDateId]);
  assert.equal(hydrateAttendanceGoingRows([legacy], [attendance(early)]).length, 1);
});

test("hydration and attendance mutations preserve exact identity and calendar timing", () => {
  const sparse = { ...legacy, showId: early.showId, tourDateId: early.tourDateId, state: "going" };
  const hydrated = hydrateAttendanceGoingRows([early], [sparse]);
  assert.equal(hydrated.length, 1);
  assert.equal(hydrated[0].startDateTime, early.startDateTime);
  const result = reconcileAttendancePlan({ show: early, result: { showId: early.showId, attendance: { state: "going" } } });
  for (const row of [result.attendanceRows[0], result.goingRows[0]]) {
    for (const field of ["showId", "tourDateId", "startDateTime", "startLocalTime", "eventTimezone", "eventEndDate", "providerEventId", "source"]) {
      assert.equal(row[field], early[field], field);
    }
  }
});

test("a sparse typed attendance update preserves timing from the existing exact Going projection", () => {
  const result = reconcileAttendancePlan({
    goingRows: [early, late], show: { showId: early.showId },
    result: { showId: early.showId, attendance: { state: "interested" } },
  });
  assert.equal(result.attendanceRows[0].startDateTime, early.startDateTime);
  assert.equal(result.attendanceRows[0].eventTimezone, early.eventTimezone);
  assert.equal(result.attendanceRows[0].tourDateId, early.tourDateId);
  assert.deepEqual(result.goingRows, [late]);
});

test("Going metadata projection excludes private payloads and malformed detail values", () => {
  const details = attendancePlanDetails({
    ...early, ticketHolder: "Private name", seat: "A12", visibility: "private", body: "private post", ownerId: "person",
    endDateTime: { secret: true }, startsAt: NaN, soldOut: false,
  });
  for (const field of ["ticketHolder", "seat", "visibility", "body", "ownerId", "endDateTime", "startsAt"]) assert.equal(details[field], undefined);
  assert.equal(details.soldOut, false);
  assert.equal(details.showId, early.showId);
});
