import assert from "node:assert/strict";
import test from "node:test";
import { beginLoadState, rejectLoadState, resolveLoadState } from "./loadState.mjs";
import { normalizePublicEventSnapshot, publicEventCandidateId, publicEventSnapshotScope, readablePublicEventSnapshot } from "./publicEventSnapshot.mjs";

const id = "tm_1718v0G65fQaZWw";
const entity = { id, kind: "event", path: `/event/${id}`, publicEventSnapshot: true,
  name: "Club 1BD Toronto", artist: "Club 1BD Toronto", venue: "REBEL", date: "2026-08-29", city: "Toronto, Canada" };

test("eligible event snapshot does not require a canonical artist and excludes private or caller-shaped fields", () => {
  const snapshot = normalizePublicEventSnapshot({ ...entity, user: { email: "private@example.org" }, review: "private", overall: 5, legacyMode: false }, id);
  assert.equal(snapshot.name, entity.name);
  assert.equal(snapshot.venue, "REBEL");
  assert.equal(snapshot.artistKey, null);
  assert.equal(Object.hasOwn(snapshot, "review"), false);
  assert.equal(Object.hasOwn(snapshot, "user"), false);
  assert.equal(Object.hasOwn(snapshot, "overall"), false);
  assert.equal(Object.isFrozen(snapshot), true);
});

test("wrong identity, unsigned caller flags, non-events, malformed dates and incomplete snapshots fail closed", () => {
  for (const patch of [
    { id: "another-event" }, { path: "/event/another-event" }, { kind: "concert" },
    { publicEventSnapshot: undefined, performanceEvent: true }, { publicEventSnapshot: "true" },
    { date: "2026-02-31" }, { date: "2026-2-01" }, { name: "" }, { venue: "" },
  ]) assert.equal(normalizePublicEventSnapshot({ ...entity, ...patch }, id), null, JSON.stringify(patch));
  assert.equal(normalizePublicEventSnapshot(entity, ""), null);
  assert.equal(normalizePublicEventSnapshot(null, id), null);
  assert.equal(normalizePublicEventSnapshot({ ...entity, date: "2036-06-14" }, id).date, "2036-06-14", "public listings must not inherit the diary input's moving two-year limit");
});

test("review posts, protected archive inputs and arbitrary flags cannot nominate a public fallback", () => {
  assert.equal(publicEventCandidateId({ id, kind: "event" }), id);
  assert.equal(publicEventCandidateId({ id, source: "ticketmaster" }), id);
  assert.equal(publicEventCandidateId({ id: "row", tourDateId: id }), id);
  assert.equal(publicEventCandidateId({ id, archiveShowKey: "protected", performanceEvent: true }), null);
  assert.equal(publicEventCandidateId({ id, userId: "member", kind: "review", performanceEvent: true }), null);
  assert.equal(publicEventCandidateId({ id, kind: "status", performanceEvent: true }), null);
  assert.equal(publicEventCandidateId({ performanceEvent: true, publicEventSnapshot: true }), null);
});

test("a confirmed legacy artist and account/event changes never inherit a ready public snapshot", () => {
  const scope = publicEventSnapshotScope(id, "member-a");
  const data = normalizePublicEventSnapshot(entity, id);
  const resource = resolveLoadState({ scope, data, updatedAt: 1 });
  assert.equal(readablePublicEventSnapshot(resource, { eventId: id, accountId: "member-a" }), data);
  assert.equal(readablePublicEventSnapshot(resource, { eventId: id, accountId: "member-a", legacyMode: true }), null);
  assert.equal(readablePublicEventSnapshot(resource, { eventId: "other", accountId: "member-a" }), null);
  assert.equal(readablePublicEventSnapshot(resource, { eventId: id, accountId: "member-b" }), null);
  assert.equal(readablePublicEventSnapshot(resource, { eventId: id, accountId: null }), null);
  assert.equal(readablePublicEventSnapshot({ ...resource, data: { ...data, id: "other" } }, { eventId: id, accountId: "member-a" }), null);
});

test("transport refresh failure retains only same-scope previously public data; a fresh denial clears it", () => {
  const scope = publicEventSnapshotScope(id, null);
  const data = normalizePublicEventSnapshot(entity, id);
  const ready = resolveLoadState({ scope, data, updatedAt: 1 });
  const refreshing = beginLoadState(ready, { scope });
  const error = Object.assign(new Error("Unavailable"), { name: "AppError", code: "PIT-REQ-002", retryable: true });
  const failed = rejectLoadState(refreshing, { scope, error });
  assert.equal(readablePublicEventSnapshot(failed, { eventId: id }), data);
  assert.equal(readablePublicEventSnapshot(resolveLoadState({ scope, data: null }), { eventId: id }), null);
});
