import assert from "node:assert/strict";
import test from "node:test";
import { friendListeningRecency, presentFriendsListening, selectRediscoverTracks } from "./listeningRediscovery.mjs";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 7, 21, 12);

test("friend listening distinguishes fresh and last-played rows and suppresses stale activity", () => {
  assert.deepEqual(friendListeningRecency(NOW - 12 * 60000, { now: NOW }), {
    at: NOW - 12 * 60000,
    ageMs: 12 * 60000,
    state: "fresh",
    label: "Played 12 minutes ago",
  });
  assert.equal(friendListeningRecency(NOW - 3 * HOUR, { now: NOW }).label, "Last played 3 hours ago");
  assert.equal(friendListeningRecency(NOW - 8 * DAY, { now: NOW }), null);
  assert.equal(friendListeningRecency(null, { now: NOW }), null);
});

test("friend listening presentation sorts recent rows and removes stale or duplicate users", () => {
  const rows = presentFriendsListening([
    { user: { id: "b" }, track: { title: "Older", at: NOW - 2 * HOUR } },
    { user: { id: "a" }, track: { title: "Fresh", at: NOW - 5 * 60000 } },
    { user: { id: "a" }, track: { title: "Duplicate", at: NOW - 4 * 60000 } },
    { user: { id: "stale" }, track: { title: "Stale", at: NOW - 9 * DAY } },
  ], { now: NOW });
  assert.deepEqual(rows.map((entry) => entry.user.id), ["a", "b"]);
  assert.equal(rows[0].recency.state, "fresh");
});

test("rediscovery uses the latest occurrence, preserves track identity, and states its bounded scope", () => {
  const rows = selectRediscoverTracks([
    { id: "old", sourceId: "src-1", title: "Old Song", artist: "Artist", at: NOW - 80 * DAY },
    { id: "recent-replay", title: "Old Song", artist: "Artist", at: NOW - 2 * DAY },
    { id: "deep", videoId: "vid-2", title: "Deep Cut", artist: "Band", at: NOW - 60 * DAY },
    { title: "Missing time", artist: "Band" },
  ], { now: NOW });
  assert.deepEqual(rows.map((track) => track.title), ["Deep Cut"]);
  assert.equal(rows[0].videoId, "vid-2");
  assert.equal(rows[0].ageLabel, "Last played 60 days ago");
  assert.equal(rows[0].historyScope, "available");
});
