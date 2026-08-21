import assert from "node:assert/strict";
import test from "node:test";
import { concertMemoryShareText, selectConcertMemories } from "./concertMemories.mjs";

const NOW = Date.UTC(2026, 7, 21, 12);

test("concert memories select a nearby anniversary before a deterministic rediscovery", () => {
  const logs = [
    { id: "anniversary", userId: "u1", artist: "SZA", venue: "History", date: "2024-08-21", overall: 4.8 },
    { id: "old-a", userId: "u1", artist: "Mitski", venue: "Massey Hall", date: "2023-02-02" },
    { id: "old-b", userId: "u1", artist: "Geese", venue: "Lee's Palace", date: "2022 · 03 · 03" },
  ];
  const first = selectConcertMemories(logs, { ownerId: "u1", now: NOW, limit: 2 });
  const second = selectConcertMemories(logs, { ownerId: "u1", now: NOW, limit: 2 });
  assert.equal(first[0].kind, "anniversary");
  assert.equal(first[0].detail, "2 years ago today");
  assert.deepEqual(second.map((memory) => memory.id), first.map((memory) => memory.id));
  assert.equal(first[1].kind, "rediscovery");
});

test("concert memories reject foreign, removed, future, status, and malformed logs", () => {
  const rows = selectConcertMemories([
    { id: "foreign", userId: "u2", artist: "A", venue: "V", date: "2020-01-01" },
    { id: "removed", userId: "u1", artist: "A", venue: "V", date: "2020-01-01", removed: true },
    { id: "future", userId: "u1", artist: "A", venue: "V", date: "2027-01-01" },
    { id: "status", userId: "u1", kind: "status", artist: "A", venue: "V", date: "2020-01-01" },
    { id: "bad-date", userId: "u1", artist: "A", venue: "V", date: "someday" },
  ], { ownerId: "u1", now: NOW });
  assert.deepEqual(rows, []);
});

test("memory sharing contains only the selected concert summary", () => {
  const copy = concertMemoryShareText({ artist: "SZA", venue: "History", date: "2024-08-21", review: "private diary text" });
  assert.match(copy, /SZA at History on 2024-08-21/);
  assert.doesNotMatch(copy, /private diary text/);
});
