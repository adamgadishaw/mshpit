import assert from "node:assert/strict";
import test from "node:test";
import {
  PROFILE_GENRE_MAX,
  profileGenreOptions,
  profileGenreSelection,
} from "./genrePreferences.mjs";

test("profile genres require one to three unique, bounded labels", () => {
  assert.equal(PROFILE_GENRE_MAX, 3);
  assert.deepEqual(profileGenreSelection([" R&B ", "Hip-Hop", "r&b"]), {
    valid: true,
    genres: ["R&B", "Hip-Hop"],
    error: null,
  });
  assert.equal(profileGenreSelection([]).valid, false);
  assert.equal(profileGenreSelection(["Rock", "Pop", "Jazz", "Punk"]).valid, false);
  assert.equal(profileGenreSelection(["Rock", { label: "Pop" }]).valid, false);
  assert.equal(profileGenreSelection(["x".repeat(31)]).valid, false);
});

test("legacy profile labels stay visible instead of being silently truncated", () => {
  assert.deepEqual(
    profileGenreOptions(["Legacy Wave", "R&B", "legacy wave"], ["R&B", "Rock"]),
    ["Legacy Wave", "R&B", "Rock"],
  );
});
