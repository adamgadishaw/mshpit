import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MAX_FOLLOWED_ARTISTS,
  artistFollowScope,
  isArtistFollowed,
  nextArtistFollowSelection,
  shouldOfferFanClubInvite,
} from "./artistFollowFanClub.mjs";

test("artist following reuses the bounded favorite-artist selection without duplicate identities", () => {
  assert.equal(isArtistFollowed(["Beyoncé"], " beyoncé "), true);
  assert.deepEqual(
    nextArtistFollowSelection(["Beyoncé", "  Beyoncé  ", "SZA"], "Mitski", { following: true }),
    { artists: ["Beyoncé", "SZA", "Mitski"], changed: true, limitReached: false },
  );
  assert.deepEqual(
    nextArtistFollowSelection(["Beyoncé", "SZA"], "BEYONCÉ", { following: false }),
    { artists: ["SZA"], changed: true, limitReached: false },
  );
});

test("artist following reports the existing profile limit instead of silently dropping another favorite", () => {
  const full = Array.from({ length: MAX_FOLLOWED_ARTISTS }, (_, index) => `Artist ${index + 1}`);
  const result = nextArtistFollowSelection(full, "One more artist", { following: true });
  assert.equal(result.limitReached, true);
  assert.equal(result.changed, false);
  assert.deepEqual(result.artists, full);
});

test("the Fan Club invitation is scoped to the account and canonical artist and only follows a confirmed opt-in", () => {
  assert.notEqual(
    artistFollowScope("account-a", { artistKey: "artist/beyonce", name: "Beyoncé" }),
    artistFollowScope("account-b", { artistKey: "artist/beyonce", name: "Beyoncé" }),
  );
  assert.equal(shouldOfferFanClubInvite({ followSucceeded: true, following: true, member: false }), true);
  assert.equal(shouldOfferFanClubInvite({ followSucceeded: false, following: true, member: false }), false);
  assert.equal(shouldOfferFanClubInvite({ followSucceeded: true, following: false, member: false }), false);
  assert.equal(shouldOfferFanClubInvite({ followSucceeded: true, following: true, member: true }), false);
});

test("ArtistScreen keeps Follow and Fan Club membership as separate explicit actions", () => {
  const source = readFileSync(new URL("../screens/ArtistScreen.jsx", import.meta.url), "utf8");
  const feature = readFileSync(new URL("../features/artistFollow/useArtistFollowFanClub.js", import.meta.url), "utf8");
  const followStart = feature.indexOf("const toggleFollow");
  const joinStart = feature.indexOf("const join =");
  const resultStart = feature.indexOf("return {", joinStart);
  assert.ok(followStart > -1 && joinStart > followStart && resultStart > joinStart);
  assert.match(feature.slice(followStart, joinStart), /updateProfile\(\{ favoriteArtists: selection\.artists \}\)/);
  assert.doesNotMatch(feature.slice(followStart, joinStart), /joinFanClub\(/);
  assert.match(feature.slice(joinStart, resultStart), /joinFanClub\(artistName\)/);
  assert.match(feature, /actionRef\.current\.sequence === operation\.sequence/);
  assert.match(source, /followUi\.invite && followed && !fanClubMember/);
  assert.match(source, />Join<\/Text>/);
  assert.match(source, />Not now<\/Text>/);
  assert.match(source, /accessibilityLabel=\{`\$\{followed \? "Unfollow" : "Follow"\} \$\{a\.name\}`\}/);
});
