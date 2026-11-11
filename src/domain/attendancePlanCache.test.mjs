import assert from "node:assert/strict";
import test from "node:test";

import { attendancePlanDetails, hydrateAttendanceGoingRows, reconcileAttendancePlan, replaceGoingPlan } from "./attendancePlanCache.mjs";
import { calendarEventTiming } from "./calendarEventTiming.mjs";

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

test("sparse legacy timing cannot select between same-night performances", () => {
  const legacyEarly = { ...legacy, startLocalTime: "7:00 PM" };
  const legacyLate = { ...legacy, startLocalTime: "22:00" };
  const sparseExact = { ...legacy, showId: early.showId, tourDateId: early.tourDateId };
  for (const rows of [[legacyEarly, legacyLate], [legacy, legacyEarly, legacyLate]]) {
    assert.deepEqual(replaceGoingPlan(rows, sparseExact, false), rows);
    assert.deepEqual(replaceGoingPlan(rows, legacy, false), rows);
  }
  assert.deepEqual(replaceGoingPlan([legacy, legacyLate], early, false), [legacy, legacyLate],
    "an untimed legacy row cannot inherit the exact target's time to bypass a conflicting legacy peer");
  assert.deepEqual(replaceGoingPlan([legacyEarly, legacyLate], early, false), [legacyLate],
    "known matching timing still permits an unambiguous upgrade");
});

test("ambiguous legacy timing cannot donate visibility to a sparse exact update", () => {
  const oldPlans = [attendance({ ...legacy, startLocalTime: "19:00" }, "going", "everyone"),
    attendance({ ...legacy, startLocalTime: "22:00" }, "going", "followers")];
  const result = reconcileAttendancePlan({
    attendanceRows: oldPlans, goingRows: oldPlans,
    show: { ...legacy, showId: early.showId },
    result: { showId: early.showId, attendance: { state: "interested" } },
  });
  assert.deepEqual(result.attendanceRows.slice(0, 2), oldPlans);
  assert.deepEqual(result.goingRows, oldPlans);
  assert.equal(result.attendanceRows[2].visibility, "private");
  assert.equal(result.attendanceRows[2].startLocalTime, undefined);
});

test("a sparse refresh keeps exact display details but server membership and privacy win", () => {
  const previous = [{ ...early, visibility: "everyone", ticketHolder: "Private name", seat: "A12", body: "Private text" }, late];
  const sparse = { ...legacy, showId: early.showId, tourDateId: early.tourDateId };
  for (const [goingRows, attendanceRows] of [[[sparse], []], [[], [attendance(sparse, "going", "private")]]]) {
    const rows = hydrateAttendanceGoingRows(goingRows, attendanceRows, previous);
    assert.equal(rows.length, 1, "previous membership cannot resurrect the omitted late performance");
    assert.equal(rows[0].startDateTime, early.startDateTime);
    assert.equal(rows[0].eventTimezone, early.eventTimezone);
    assert.equal(rows[0].providerEventId, early.providerEventId);
    for (const field of ["ticketHolder", "seat", "body"]) assert.equal(rows[0][field], undefined);
    assert.equal(rows[0].visibility, attendanceRows.length ? "private" : undefined);
  }
  assert.deepEqual(hydrateAttendanceGoingRows([], [], previous), []);
  assert.deepEqual(hydrateAttendanceGoingRows([], [attendance(sparse, "interested")], previous), []);
});

test("refresh donors cannot override server details or cross identity and schedule boundaries", () => {
  const sparse = { ...legacy, showId: early.showId, tourDateId: early.tourDateId };
  const current = { ...sparse, startDateTime: null, startLocalTime: "20:00", soldOut: false };
  const rows = hydrateAttendanceGoingRows([current], [], [{ ...early, soldOut: true }]);
  assert.equal(rows[0].startDateTime, null, "explicit server clearing wins over cached timing");
  assert.equal(rows[0].startLocalTime, "20:00");
  assert.equal(rows[0].soldOut, false);
  for (const donor of [late, { ...early, tourDateId: "conflicting" }, { ...early, date: "2026-09-18" },
    { ...early, city: "Vancouver" }, { ...legacy, startLocalTime: "19:00" }]) {
    assert.equal(hydrateAttendanceGoingRows([sparse], [], [donor])[0].startLocalTime, undefined);
  }
});

test("a sparse canonical update retains exact Going timing without inheriting private donor fields", () => {
  const sparse = attendance({ ...legacy, showId: early.showId, tourDateId: early.tourDateId }, "going", "private");
  const donor = { ...early, visibility: "everyone", ticketHolder: "Private name", seat: "A12", body: "Private text" };
  const result = reconcileAttendancePlan({
    attendanceRows: [sparse], goingRows: [donor, late], show: { showId: early.showId },
    result: { showId: early.showId, attendance: { state: "going" } },
  });
  const saved = result.attendanceRows[0];
  assert.equal(saved.startDateTime, early.startDateTime);
  assert.equal(saved.eventTimezone, early.eventTimezone);
  assert.equal(saved.visibility, "private");
  assert.equal(result.goingRows.find((row) => row.showId === early.showId).startDateTime, early.startDateTime);
  for (const field of ["ticketHolder", "seat", "body"]) assert.equal(saved[field], undefined);
  assert.deepEqual(result.goingRows.find((row) => row.showId === late.showId), late);
});

test("typed updates cannot borrow Going timing from another exact identity or rescheduled date", () => {
  const sparse = attendance({ ...legacy, showId: early.showId, tourDateId: early.tourDateId });
  for (const donor of [late, { ...early, tourDateId: "conflicting" }, { ...early, date: "2026-09-18" }]) {
    const result = reconcileAttendancePlan({
      attendanceRows: [sparse], goingRows: [donor], show: { showId: early.showId, tourDateId: early.tourDateId },
      result: { showId: early.showId, attendance: { state: "going" } },
    });
    assert.equal(result.attendanceRows[0].startDateTime, undefined);
  }
});

test("incoming date changes and explicit timing clears cannot revive old Going timing", () => {
  const sparse = attendance({ ...legacy, showId: early.showId, tourDateId: early.tourDateId });
  for (const update of [{ date: "2026-09-18" }, { localDate: "2026-09-18" },
    { startDateTime: null, startLocalTime: null }]) {
    const result = reconcileAttendancePlan({
      attendanceRows: [sparse], goingRows: [early, late], show: { showId: early.showId, ...update },
      result: { showId: early.showId, attendance: { state: "going", visibility: "private" } },
    });
    for (const row of [result.attendanceRows[0], result.goingRows.find((entry) => entry.showId === early.showId)]) {
      assert.equal(row.startDateTime, undefined);
      assert.equal(row.startLocalTime, undefined);
      assert.equal(row.date, update.date || update.localDate || early.date);
    }
    assert.deepEqual(result.goingRows.find((row) => row.showId === late.showId), late);
  }
});

test("incoming timing owns the whole schedule across aliases, zones, ends and clears", () => {
  const sparse = attendance({ ...legacy, showId: early.showId, tourDateId: early.tourDateId });
  const donor = { ...early, endDateTime: "2026-09-17T01:00:00Z", endLocalTime: "21:00",
    doorsDateTime: "2026-09-16T22:00:00Z", doorsLocalTime: "18:00" };
  const cases = [
    { startLocalTime: "22:00", eventTimezone: "America/Toronto" },
    { localStartTime: "22:00", eventTimezone: "America/Toronto" },
    { showStartTime: "22:00", eventTimezone: "America/Toronto" },
    { startTime: "22:00", eventTimezone: "America/Toronto" },
    ...["startDateTime", "showStartDateTime", "startsAt", "startAt"].map((field) => ({ [field]: "2026-09-17T02:00:00Z" })),
    ...["eventTimezone", "timezone", "timeZone"].map((field) => ({ [field]: "America/Vancouver" })),
    ...["eventEndDateTime", "endDateTime", "endsAt", "endAt"].map((field) => ({ [field]: "2026-09-17T04:00:00Z" })),
    ...["eventEndDate", "endDate"].map((field) => ({ [field]: "2026-09-18" })),
    { endLocalTime: "23:00" }, { doorsDateTime: "2026-09-17T01:00:00Z" }, { doorsLocalTime: "21:00" },
    { startDateTime: null }, { startLocalTime: null }, { eventTimezone: null }, { endDateTime: null },
  ];
  for (const update of cases) {
    const result = reconcileAttendancePlan({
      attendanceRows: [sparse], goingRows: [donor, late], show: { showId: early.showId, ...update },
      result: { showId: early.showId, attendance: { state: "going" } },
    });
    for (const row of [result.attendanceRows[0], result.goingRows.find((entry) => entry.showId === early.showId)]) {
      assert.deepEqual(calendarEventTiming(row), calendarEventTiming({ ...sparse, ...update }), JSON.stringify(update));
      for (const field of ["startDateTime", "startLocalTime", "eventTimezone", "eventEndDate", "endDateTime",
        "endLocalTime", "doorsDateTime", "doorsLocalTime"]) {
        assert.equal(row[field], update[field] ?? undefined, `${JSON.stringify(update)}: ${field}`);
      }
      assert.equal(row.providerEventId, early.providerEventId, "unrelated exact provider metadata can still be retained");
    }
  }
});

test("canonical, Going and refreshed caches consistently discard superseded timing", () => {
  const sparse = { ...legacy, showId: early.showId, tourDateId: early.tourDateId };
  const rich = { ...early, endDateTime: "2026-09-17T01:00:00Z", doorsLocalTime: "18:00" };
  const updates = [
    { startLocalTime: "22:00", eventTimezone: "America/Toronto" },
    { showStartTime: "22:00", timezone: "America/Toronto" },
    { startsAt: "2026-09-17T02:00:00Z", eventTimezone: "America/Toronto" },
    { startDateTime: null }, { startLocalTime: null }, { eventTimezone: null },
    { date: "2026-09-18" }, { localDate: "2026-09-18" },
  ];
  for (const update of updates) {
    const incoming = { ...sparse, ...update };
    const effectiveDate = update.localDate || update.date || sparse.date;
    const expectedTiming = calendarEventTiming({ ...incoming, date: effectiveDate });
    for (const attendanceRows of [[attendance(rich, "going", "followers")], []]) {
      const result = reconcileAttendancePlan({
        attendanceRows, goingRows: [rich, late], show: incoming,
        result: { showId: early.showId, attendance: { state: "going", visibility: "private" } },
      });
      assert.equal(result.attendanceRows[0].visibility, "private");
      for (const row of [result.attendanceRows[0], result.goingRows.find((entry) => entry.showId === early.showId)]) {
        assert.deepEqual(calendarEventTiming(row), expectedTiming, `typed ${JSON.stringify(update)}`);
      }
      assert.deepEqual(result.goingRows.find((row) => row.showId === late.showId), late);
    }
    // Refresh and direct Going use date as the canonical day; typed writes also
    // support localDate, tested above.
    const refreshed = { ...incoming, date: effectiveDate };
    for (const rows of [
      replaceGoingPlan([rich, late], refreshed, true),
      hydrateAttendanceGoingRows([refreshed], [], [rich, late]),
      hydrateAttendanceGoingRows([], [attendance(refreshed)], [rich, late]),
      hydrateAttendanceGoingRows([rich], [attendance(refreshed)]),
    ]) {
      assert.deepEqual(calendarEventTiming(rows.find((row) => row.showId === early.showId)), expectedTiming,
        `Going/refresh ${JSON.stringify(update)}`);
    }
  }
});
