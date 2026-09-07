import assert from "node:assert/strict";
import test from "node:test";
import {
  PROFILE_GENRE_MAX,
  PROFILE_GENRE_OPTIONS,
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

test("signup and profile defaults include broad musical tastes without rewriting custom preferences", () => {
  for (const genre of ["Pop", "R&B", "Rock", "Country", "Latin", "Afrobeats", "Reggae", "Classical", "Gospel", "K-Pop"])
    assert.ok(PROFILE_GENRE_OPTIONS.includes(genre), `${genre} must be selectable`);
  for (const genre of PROFILE_GENRE_OPTIONS) assert.equal(profileGenreSelection([genre]).valid, true);
  assert.equal(new Set(PROFILE_GENRE_OPTIONS.map((genre) => genre.toLowerCase())).size, PROFILE_GENRE_OPTIONS.length);
  const saved = ["Chamber Pop", "r&b", "Tamil Folk"];
  const options = profileGenreOptions(saved);
  assert.deepEqual(options.slice(0, 3), saved);
  assert.equal(options.filter((genre) => genre.toLowerCase() === "r&b").length, 1);
  assert.deepEqual(saved, ["Chamber Pop", "r&b", "Tamil Folk"]);
});
