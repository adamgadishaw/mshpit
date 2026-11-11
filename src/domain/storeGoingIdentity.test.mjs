import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import { attendancePlanDetails, hydrateAttendanceGoingRows, reconcileAttendancePlan, replaceGoingPlan } from "./attendancePlanCache.mjs";
import { toIsoDate } from "./dates.mjs";
import { createGoingIntentCoordinator, goingIntentKey } from "./goingIntent.mjs";

// Exercise the production Store actions, including their request coordination,
// optimistic writes and rollback, without mounting the entire React provider.
const source = readFileSync(new URL("../store.js", import.meta.url), "utf8");
const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
const provider = ast.program.body.find((node) => node.declaration?.id?.name === "StoreProvider").declaration;
const declarations = provider.body.body.flatMap((node) => node.type === "VariableDeclaration" ? node.declarations : []);
const names = ["norm", "concertKey", "goingTourDateId", "goingEntryIdentity", "goingEntryMatches", "adoptAttendanceSnapshot", "applyMyAttendanceMutation", "commitGoingState", "setGoingIntent"];
const callbacks = names.map((name) => {
  const node = declarations.find((entry) => entry.id?.name === name);
  assert.ok(node, `Store must expose ${name}`);
  return `const ${source.slice(node.start, node.end)};`;
}).join("\n");
const owner = { id: "account-a" };
const key = "artist|venue|2026-09-16";
const early = { key, artist: "Artist", venue: "Venue", city: "Toronto", date: "2026-09-16", tourDateId: "early", showId: "show_early", startDateTime: "2026-09-16T23:00:00Z", startLocalTime: "19:00", eventTimezone: "America/Toronto", eventEndDate: "2026-09-17" };
const late = { ...early, tourDateId: "late", showId: "show_late", startDateTime: "2026-09-17T02:00:00Z", startLocalTime: "22:00" };
const tick = () => new Promise((resolve) => setImmediate(resolve));

function fixture(rows = []) {
  const calls = [], state = { going: { [owner.id]: rows }, pending: {} };
  const sessionRef = { current: owner };
  const goingRef = { current: state.going, attendance: { accountId: owner.id, rows: [] } };
  const goingIntentRef = { current: createGoingIntentCoordinator() };
  const goingConfirmedRef = { current: new Map() };
  const goingPendingRef = { current: {} }, goingMutationRevisionRef = { current: 0 };
  const dependencies = {
    attendancePlanDetails, hydrateAttendanceGoingRows, reconcileAttendancePlan, replaceGoingPlan, toIsoDate, goingIntentKey,
    goingRef, goingIntentRef, goingConfirmedRef, goingPendingRef, goingMutationRevisionRef, sessionRef,
    currentMutationActor: () => sessionRef.current,
    setGoing: (value) => { state.going = value; },
    setGoingPending: (value) => { state.pending = value; },
    api: (path, options) => new Promise((resolve, reject) => calls.push({ path, options, resolve, reject })),
  };
  const actions = new Function(...Object.keys(dependencies), `"use strict"; ${callbacks}\nreturn {${names.join(",")}};`)(...Object.values(dependencies));
  return { actions, state, calls, goingRef, sessionRef, goingIntentRef, goingMutationRevisionRef };
}

test("two same-night performances send independently, settle independently and clear their own pending state", async () => {
  const f = fixture();
  const first = f.actions.setGoingIntent(early, true);
  const second = f.actions.setGoingIntent(late, true);
  assert.deepEqual(f.state.going[owner.id].map((row) => row.tourDateId), ["early", "late"]);
  await tick();
  assert.equal(f.calls.length, 2, "one performance cannot queue or supersede a different performance");
  f.calls[1].resolve({ going: true, showId: late.showId });
  assert.equal((await second).ok, true);
  assert.deepEqual(Object.keys(f.state.pending), [goingIntentKey(owner.id, "tour-date:early")]);
  f.calls[0].reject(new Error("Early show write failed"));
  assert.equal((await first).ok, false);
  assert.deepEqual(f.state.going[owner.id].map((row) => row.tourDateId), ["late"]);
  assert.deepEqual(f.state.pending, {});
});

test("rapid changes to one performance are ordered and only the latest intent updates the view", async () => {
  const f = fixture([late]);
  const first = f.actions.setGoingIntent(early, true);
  const second = f.actions.setGoingIntent(early, false);
  assert.deepEqual(f.state.going[owner.id].map((row) => row.tourDateId), ["late"]);
  await tick();
  assert.equal(f.calls.length, 1);
  f.calls[0].resolve({ going: true, showId: early.showId });
  assert.equal((await first).stale, true);
  assert.deepEqual(f.state.going[owner.id].map((row) => row.tourDateId), ["late"]);
  await tick();
  assert.equal(f.calls[1].options.body.going, false);
  f.calls[1].resolve({ going: false, showId: early.showId });
  assert.equal((await second).ok, true);
  assert.deepEqual(f.state.going[owner.id].map((row) => row.tourDateId), ["late"]);
  assert.deepEqual(f.state.pending, {});
});

test("a failed latest intent restores the last confirmed state without affecting the other performance", async () => {
  const f = fixture([late]);
  const first = f.actions.setGoingIntent(early, true);
  const second = f.actions.setGoingIntent(early, false);
  await tick();
  f.calls[0].resolve({ going: true, showId: early.showId });
  await first; await tick();
  f.calls[1].reject(new Error("Removal failed"));
  assert.equal((await second).going, true);
  assert.deepEqual(f.state.going[owner.id].map((row) => row.tourDateId), ["late", "early"]);
  assert.equal(f.state.going[owner.id][1].startDateTime, early.startDateTime);
  assert.deepEqual(f.state.pending, {});
});

test("optimistic and confirmed Going retain local timing without changing the attendance request contract", async () => {
  const f = fixture();
  const pending = f.actions.setGoingIntent(early, true);
  for (const field of ["showId", "startDateTime", "startLocalTime", "eventTimezone", "eventEndDate"]) assert.equal(f.state.going[owner.id][0][field], early[field]);
  await tick();
  assert.deepEqual(Object.keys(f.calls[0].options.body).sort(), ["key", "tourDateId", "artist", "artistKey", "venue", "venueKey", "city", "date", "tour", "going"].sort());
  assert.equal(f.calls[0].options.expectedAccountId, owner.id);
  f.calls[0].resolve({ going: true, showId: early.showId });
  await pending;
  assert.equal(f.state.going[owner.id][0].eventTimezone, early.eventTimezone);
});

test("a failed sparse removal restores timing retained in the existing exact Going row", async () => {
  const f = fixture([early, late]);
  const sparse = { artist: early.artist, venue: early.venue, date: early.date, tourDateId: early.tourDateId };
  const pending = f.actions.setGoingIntent(sparse, false);
  await tick();
  f.calls[0].reject(new Error("Removal failed"));
  await pending;
  const restored = f.state.going[owner.id].find((row) => row.tourDateId === early.tourDateId);
  assert.equal(restored.showId, early.showId);
  assert.equal(restored.startDateTime, early.startDateTime);
  assert.equal(restored.eventTimezone, early.eventTimezone);
});

test("an account change invalidates queued and completing Going writes", async () => {
  const f = fixture();
  const first = f.actions.setGoingIntent(early, true);
  const queued = f.actions.setGoingIntent(early, false);
  await tick();
  f.sessionRef.current = { id: "account-b" };
  f.goingIntentRef.current.reset();
  const snapshot = structuredClone(f.state);
  f.calls[0].resolve({ going: true, showId: early.showId });
  assert.equal((await first).stale, true);
  assert.equal((await queued).stale, true);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.state, snapshot);
});

test("Store hydration retains distinct performances and refuses a pre-mutation snapshot", () => {
  const f = fixture();
  const legacy = { key, artist: early.artist, venue: early.venue, date: early.date, city: early.city };
  const result = f.actions.adoptAttendanceSnapshot(owner.id, [legacy], [{ ...early, state: "going" }, { ...late, state: "going" }], 0);
  assert.equal(result[owner.id].length, 3);
  assert.deepEqual(result[owner.id].map((row) => row.tourDateId), [undefined, "early", "late"]);
  f.goingMutationRevisionRef.current += 1;
  assert.equal(f.actions.adoptAttendanceSnapshot(owner.id, [], [], 0), false);
  assert.equal(f.goingRef.current[owner.id].length, 3);
});

test("a failed add after an authoritative refresh cannot revive stale confirmed membership", async () => {
  const f = fixture([late]);
  const initial = f.actions.setGoingIntent(early, true);
  await tick();
  f.calls[0].resolve({ going: true, showId: early.showId });
  await initial;
  const refreshed = f.actions.adoptAttendanceSnapshot(owner.id, [late], [], f.goingMutationRevisionRef.current);
  assert.deepEqual(refreshed[owner.id], [late]);
  const retry = f.actions.setGoingIntent(early, true);
  await tick();
  f.calls[1].reject(new Error("Add failed"));
  assert.equal((await retry).going, false);
  assert.deepEqual(f.state.going[owner.id], [late]);
  assert.deepEqual(f.state.pending, {});
});

test("a failed add after typed attendance changes cannot restore an obsolete Going confirmation", async () => {
  for (const state of ["interested", null]) {
    const f = fixture([late]);
    const initial = f.actions.setGoingIntent(early, true);
    await tick();
    f.calls[0].resolve({ going: true, showId: early.showId });
    await initial;
    assert.equal(f.actions.applyMyAttendanceMutation(early, {
      showId: early.showId, attendance: state ? { state, visibility: "private" } : null,
    }), true);
    assert.deepEqual(f.state.going[owner.id], [late]);
    const retry = f.actions.setGoingIntent(early, true);
    await tick();
    f.calls[1].reject(new Error("Add failed"));
    assert.equal((await retry).going, false);
    assert.deepEqual(f.state.going[owner.id], [late]);
    assert.deepEqual(f.state.pending, {});
    assert.equal(f.goingRef.attendance.rows[0]?.state ?? null, state);
  }
});

test("a failed removal retains newer typed Going even after an earlier confirmed removal", async () => {
  const f = fixture([early, late]);
  const initial = f.actions.setGoingIntent(early, false);
  await tick();
  f.calls[0].resolve({ going: false, showId: early.showId });
  await initial;
  f.actions.applyMyAttendanceMutation(early, { showId: early.showId, attendance: { state: "going", visibility: "private" } });
  const retry = f.actions.setGoingIntent(early, false);
  await tick();
  f.calls[1].reject(new Error("Removal failed"));
  assert.equal((await retry).going, true);
  assert.deepEqual(f.state.going[owner.id].map((row) => row.tourDateId), ["late", "early"]);
  assert.equal(f.state.going[owner.id][1].startDateTime, early.startDateTime);
  assert.equal(f.goingRef.attendance.rows[0].visibility, "private");
  assert.deepEqual(f.state.pending, {});
});

test("Store refresh retains exact display timing and does not resurrect omitted plans", () => {
  const f = fixture([early, late]);
  const sparse = { key, artist: early.artist, venue: early.venue, date: early.date,
    showId: early.showId, tourDateId: early.tourDateId, state: "going", visibility: "private" };
  const result = f.actions.adoptAttendanceSnapshot(owner.id, [], [sparse], 0);
  assert.equal(result[owner.id].length, 1);
  assert.equal(result[owner.id][0].startDateTime, early.startDateTime);
  assert.equal(result[owner.id][0].eventTimezone, early.eventTimezone);
  assert.equal(result[owner.id][0].visibility, "private");
  assert.equal(f.actions.applyMyAttendanceMutation({ showId: early.showId }, {
    showId: early.showId, attendance: { state: "going", visibility: "private" },
  }), true);
  assert.equal(f.state.going[owner.id][0].startDateTime, early.startDateTime,
    "a subsequent sparse typed write preserves the richer refreshed Going projection");
});
