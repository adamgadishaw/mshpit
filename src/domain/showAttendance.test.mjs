import assert from "node:assert/strict";
import test from "node:test";
import {
  attendanceControlsVisible, attendanceMutationIdentity, attendanceOptionsForPhase, attendanceStateDisplayLabel, attendanceTotalForView,
  normalizeAttendanceMutation, normalizeAttendanceSnapshot, normalizeAttendanceState,
  normalizeAttendanceVisibility, normalizeStableShowId, normalizeViewerAttendance,
  optimisticViewerAttendance, postShowAttendanceCutoff, viewerGoingForCrowd,
} from "./showAttendance.mjs";

test("attendance snapshot keeps the authoritative total beyond the bounded page", () => {
  const snapshot = normalizeAttendanceSnapshot({ attendees: [{ id: "1" }, { id: "2" }], total: 205, nextCursor: "next" });
  assert.equal(snapshot.total, 205);
  assert.equal(snapshot.nextCursor, "next");
  assert.deepEqual(snapshot.attendees.map((row) => row.state), ["going", "going"]);
});

test("typed attendance normalizes states, privacy, Crowd scope, and real verification separately", () => {
  const snapshot = normalizeAttendanceSnapshot({
    attendees: [{ id: "1", state: "here", verifiedAttendance: true }, { id: "2", state: "invented" }],
    total: 14,
    viewerAttendance: { state: "went", visibility: "followers", verified: true, showId: "show_1", checkedInAt: 123 },
    stateCounts: { interested: 3, going: 5, here: 2, went: 4, invented: 999 },
    verifiedAttendeeCount: 6,
    scope: "friends",
    showId: "show_1",
  });
  assert.deepEqual(snapshot.attendees.map((row) => [row.state, row.verifiedAttendance]), [["here", true], ["going", false]]);
  assert.deepEqual(snapshot.viewerAttendance, { state: "went", visibility: "followers", verified: true, showId: "show_1", checkedInAt: 123 });
  assert.deepEqual(snapshot.stateCounts, { interested: 3, going: 5, here: 2, went: 4 });
  assert.equal(snapshot.verifiedAttendeeCount, 6);
  assert.equal(snapshot.scope, "friends");
  assert.equal(snapshot.showId, "show_1");
});

test("old Going payloads remain readable during a rolling deployment", () => {
  assert.deepEqual(normalizeViewerAttendance({ viewerGoing: true }), {
    state: "going", visibility: "members", verified: false, showId: null, checkedInAt: null,
  });
  assert.equal(normalizeAttendanceSnapshot({ viewerGoing: false }).viewerAttendance, null);
});

test("nullable check-ins stay null and nested show identity is accepted defensively", () => {
  const payload = {
    show: { id: "show_nested" },
    viewerAttendance: { state: "here", visibility: "private", checkedInAt: null },
  };
  assert.deepEqual(normalizeViewerAttendance(payload), {
    state: "here", visibility: "private", verified: false, showId: "show_nested", checkedInAt: null,
  });
  assert.equal(normalizeAttendanceSnapshot(payload).showId, "show_nested");
  assert.equal(normalizeViewerAttendance({
    viewerAttendance: { state: "here", checkedInAt: "" },
  }).checkedInAt, null);
});

test("viewerGoing fallback treats every attendee state consistently", () => {
  for (const state of ["going", "here", "went"]) {
    assert.equal(normalizeAttendanceSnapshot({ viewerAttendance: { state } }).viewerGoing, true, state);
  }
  assert.equal(normalizeAttendanceSnapshot({ viewerAttendance: { state: "interested" } }).viewerGoing, false);
  assert.equal(normalizeAttendanceSnapshot({
    viewerGoing: false,
    viewerAttendance: { state: "here" },
  }).viewerGoing, false, "an explicit rolling-server boolean remains authoritative");
});

test("invalid attendance values fail closed and phase options stay intentionally small", () => {
  assert.equal(normalizeAttendanceState("teleported"), null);
  assert.equal(normalizeAttendanceVisibility("worldwide"), "members");
  assert.deepEqual(attendanceOptionsForPhase("upcoming"), ["interested", "going"]);
  assert.deepEqual(attendanceOptionsForPhase("happening"), ["going", "here"]);
  assert.deepEqual(attendanceOptionsForPhase("completed"), ["went"]);
  assert.deepEqual(attendanceOptionsForPhase("postponed"), []);
  assert.deepEqual(attendanceOptionsForPhase("cancelled"), []);
  assert.deepEqual(attendanceOptionsForPhase("unknown"), []);
});

test("typed mutation identity and response normalization reject cross-Show adoption", () => {
  const showId = `show_${"a".repeat(64)}`;
  const otherId = `show_${"b".repeat(64)}`;
  assert.equal(normalizeStableShowId(showId), showId);
  assert.equal(normalizeStableShowId("artist|venue|date"), null);
  assert.notEqual(attendanceMutationIdentity(showId, "fan-a"), attendanceMutationIdentity(showId, "fan-b"));
  assert.equal(normalizeAttendanceMutation({
    showId: otherId,
    attendance: { showId: otherId, state: "went", visibility: "members" },
  }, showId), null);
  assert.deepEqual(normalizeAttendanceMutation({
    showId,
    attendance: { showId, state: "went", visibility: "followers", verified: true },
  }, showId), {
    showId,
    state: "went",
    visibility: "followers",
    going: true,
    attendance: {
      state: "went", visibility: "followers", verified: true, showId, checkedInAt: null,
    },
  });
});

test("optimistic Here starts private while historical Went never requires location data", () => {
  const showId = `show_${"c".repeat(64)}`;
  const going = { state: "going", visibility: "members", verified: false, showId, checkedInAt: null };
  assert.deepEqual(optimisticViewerAttendance(going, { state: "here" }), {
    state: "here", visibility: "private", verified: false, showId, checkedInAt: null,
  });
  assert.deepEqual(optimisticViewerAttendance(going, { state: "went" }), {
    state: "went", visibility: "members", verified: false, showId, checkedInAt: null,
  });
  assert.equal(optimisticViewerAttendance(going, { state: null }), null);
});

test("cancelled and postponed Shows retain privacy self-service for existing attendance", () => {
  const showId = `show_${"d".repeat(64)}`;
  assert.equal(attendanceControlsVisible({ showId, phase: "cancelled" }), false);
  assert.equal(attendanceControlsVisible({
    showId,
    phase: "cancelled",
    currentAttendance: { state: "going", visibility: "members" },
  }), true);
  assert.equal(attendanceControlsVisible({
    showId,
    phase: "postponed",
    currentAttendance: { state: "interested", visibility: "followers" },
  }), true);
  assert.equal(attendanceControlsVisible({ showId, phase: "cancelled", mutationPending: true }), true);
  assert.equal(attendanceControlsVisible({ showId: "legacy|room|date", phase: "upcoming" }), false);
});

test("optimistic viewer intent adjusts the server total without dropping visible rows", () => {
  assert.equal(attendanceTotalForView({ total: 205, serverViewerGoing: false, viewerGoing: true, visibleCount: 30 }), 206);
  assert.equal(attendanceTotalForView({ total: 205, serverViewerGoing: true, viewerGoing: false, visibleCount: 30 }), 204);
  assert.equal(attendanceTotalForView({ total: 0, serverViewerGoing: false, viewerGoing: false, visibleCount: 2 }), 2);
});

test("Crowd reconciliation trusts canonical Here/Went membership except during an optimistic mutation", () => {
  assert.equal(viewerGoingForCrowd({
    scope: "everyone", localGoing: false, mutationPending: false,
    authoritativeReady: true, serverViewerGoing: true,
  }), true, "canonical Here/Went membership survives a false legacy Going projection");
  assert.equal(viewerGoingForCrowd({
    scope: "everyone", localGoing: true, mutationPending: false,
    authoritativeReady: true, serverViewerGoing: false,
  }), false, "a ready canonical response wins when no write is pending");
  assert.equal(viewerGoingForCrowd({
    scope: "everyone", localGoing: true, mutationPending: true,
    authoritativeReady: true, serverViewerGoing: false,
  }), true, "an in-flight tap remains optimistic");
  for (const scope of ["following", "friends"]) {
    assert.equal(viewerGoingForCrowd({
      scope, localGoing: true, mutationPending: true,
      authoritativeReady: true, serverViewerGoing: true,
    }), false, "filtered scopes never add the viewer implicitly");
  }
});

test("Going becomes Attended only after the conservative post-show cutoff", () => {
  const startsAt = Date.parse("2026-09-16T23:00:00.000Z");
  const cutoff = postShowAttendanceCutoff({ startsAt });
  assert.equal(cutoff, startsAt + (4 * 60 * 60 * 1_000) + (24 * 60 * 60 * 1_000));
  assert.equal(attendanceStateDisplayLabel("going", { cutoffAt: cutoff, now: cutoff - 1 }), "Going");
  assert.equal(attendanceStateDisplayLabel("going", { cutoffAt: cutoff, now: cutoff }), "Attended");
  assert.equal(attendanceStateDisplayLabel("here", { cutoffAt: cutoff, now: cutoff }), "Attended");
  assert.equal(attendanceStateDisplayLabel("went", { now: 0 }), "Attended");
  assert.equal(attendanceStateDisplayLabel("interested", { now: cutoff + 1 }), "Interested");
});

test("date-only shows wait until the following day has fully passed", () => {
  const cutoff = postShowAttendanceCutoff({ date: "2026-09-16" });
  assert.equal(cutoff, Date.parse("2026-09-17T23:59:59.999Z"));
  assert.equal(attendanceStateDisplayLabel("going", { show: { date: "2026-09-16" }, now: cutoff - 1 }), "Going");
  assert.equal(attendanceStateDisplayLabel("going", { show: { date: "2026-09-16" }, now: cutoff }), "Attended");
});
