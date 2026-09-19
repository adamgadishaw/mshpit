import assert from "node:assert/strict";
import test from "node:test";
import { composerArtistMediaConsent } from "./composerArtistMediaConsent.mjs";

test("artist status and featured media can opt in without buying or receiving a check", () => {
  const user = { role: "artist", artistName: "  New Band  ", verified: false };
  assert.deepEqual(composerArtistMediaConsent({ postType: "status", user }), {
    available: true, artistName: "New Band", photosPublic: false,
  });
  assert.equal(composerArtistMediaConsent({ postType: "status", user, photosPublic: true }).photosPublic, true);
  assert.equal(composerArtistMediaConsent({ postType: "status", user, photosPublic: false }).photosPublic, false);
  assert.equal(composerArtistMediaConsent({ postType: "status", user, photosPublic: "true" }).photosPublic, false);
});

test("fan status cannot acquire artist gallery consent from typed or restored names", () => {
  for (const user of [null, { role: "fan", artistName: "Another band" }, { role: "artist", artistName: " " }]) {
    assert.equal(composerArtistMediaConsent({ postType: "status", user, artist: "Another band", photosPublic: true }).available, false);
    assert.equal(composerArtistMediaConsent({ postType: "status", user, artist: "Another band", photosPublic: true }).photosPublic, false);
  }
});

test("reviews and memories retain their distinct optional gallery consent", () => {
  for (const postType of ["show", "memory"]) {
    assert.deepEqual(composerArtistMediaConsent({ postType, artist: "Fan's chosen artist" }), {
      available: true, artistName: "Fan's chosen artist", photosPublic: false,
    });
    assert.equal(composerArtistMediaConsent({ postType, photosPublic: true }).photosPublic, true);
  }
  assert.equal(composerArtistMediaConsent({ photosPublic: true }).photosPublic, false);
});
