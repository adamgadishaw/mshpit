import assert from "node:assert/strict";
import test from "node:test";

import {
  applyFanClubMembership,
  createFanClubDirectoryReadCoordinator,
  fanClubSearchResults,
  normalizeFanClubDirectory,
  projectFanClubArtistCandidate,
} from "./fanClubDirectory.mjs";

test("authoritative directory snapshots are normalized, deduplicated, and ranked", () => {
  assert.deepEqual(normalizeFanClubDirectory([
    { artist: "SZA", members: "12", messages: 4 },
    { artist: "sza", members: 2, messages: 99 },
    { artist: "Turnstile", members: 20, messages: "8" },
    { artist: "", members: 100 },
  ]), [
    { artist: "Turnstile", members: 20, messages: 8 },
    { artist: "SZA", members: 12, messages: 4 },
  ]);
});

test("optimistic membership changes preserve message-only clubs and remove empty clubs", () => {
  const rows = [{ artist: "Turnstile", members: 1, messages: 0 }, { artist: "Geese", members: 1, messages: 4 }];
  assert.deepEqual(applyFanClubMembership(rows, { artist: "Turnstile", wasMember: true, joined: false }), [
    { artist: "Geese", members: 1, messages: 4 },
  ]);
  assert.deepEqual(applyFanClubMembership(rows, { artist: "Geese", wasMember: true, joined: false }), [
    { artist: "Turnstile", members: 1, messages: 0 },
    { artist: "Geese", members: 0, messages: 4 },
  ]);
  assert.deepEqual(applyFanClubMembership([], { artist: "Model/Actriz", wasMember: false, joined: true }), [
    { artist: "Model/Actriz", members: 1, messages: 0 },
  ]);
});

test("directory reads reject older refreshes and responses from another account scope", () => {
  const reads = createFanClubDirectoryReadCoordinator();
  const guest = reads.claim(null);
  const account = reads.claim("u_1");
  assert.equal(reads.isCurrent(guest, null), false);
  assert.equal(reads.isCurrent(account, "u_2"), false);
  assert.equal(reads.isCurrent(account, "u_1"), true);
  reads.reset();
  assert.equal(reads.isCurrent(account, "u_1"), false);
});

test("fan-club search uses the current join snapshot instead of mount-time membership", () => {
  const catalog = [{ name: "Turnstile", fanClubAvailable: true }];
  const beforeJoin = fanClubSearchResults([], catalog, "turn");
  const afterJoin = fanClubSearchResults([{ artist: "Turnstile", members: 1, messages: 3 }], catalog, "turn");
  const afterLeave = fanClubSearchResults([], catalog, "turn");
  assert.deepEqual(beforeJoin, [{ artist: "Turnstile", members: 0, messages: 0 }]);
  assert.deepEqual(afterJoin, [{ artist: "Turnstile", members: 1, messages: 3 }]);
  assert.deepEqual(afterLeave, [{ artist: "Turnstile", members: 0, messages: 0 }]);
});

test("active clubs win over catalog fallbacks, deduplicate case-insensitively, and stay bounded", () => {
  const rows = fanClubSearchResults(
    [{ artist: "SZA", members: "12", messages: 4 }, { artist: "sza", members: 1 }],
    [
      { name: "SZA", fanClubAvailable: true },
      { name: "Sizzy Rocket", fanClubAvailable: true },
      { name: "Unrelated", fanClubAvailable: true },
    ],
    "s",
    2,
  );
  assert.deepEqual(rows, [
    { artist: "SZA", members: 12, messages: 4 },
    { artist: "Sizzy Rocket", members: 0, messages: 0 },
  ]);
  assert.deepEqual(fanClubSearchResults([{ artist: "SZA", members: 12 }], [], "s", 0), []);
});

test("catalogue candidates fail closed until fan-club eligibility is authoritative", () => {
  const projected = [
    projectFanClubArtistCandidate({ name: "Legacy Artist", fanClubAvailable: false }),
    projectFanClubArtistCandidate({ name: "Unverified Artist" }),
    projectFanClubArtistCandidate({ name: "Living Artist", fanClubAvailable: true }),
  ];
  assert.deepEqual(fanClubSearchResults([], projected, "artist"), [
    { artist: "Living Artist", members: 0, messages: 0 },
  ]);

  // Active directory rows were already filtered by the server and remain
  // discoverable even though they do not need a second client-only flag.
  assert.deepEqual(fanClubSearchResults([
    { artist: "Active Artist", members: 3, messages: 8 },
  ], [], "active"), [
    { artist: "Active Artist", members: 3, messages: 8 },
  ]);
});
