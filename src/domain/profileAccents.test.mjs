import assert from "node:assert/strict";
import test from "node:test";
import { PROFILE_ACCENT_OPTIONS, PROFILE_FAVORITE_SHOWS_MAX, PROFILE_PRONOUNS_MAX, pinnableShow, profileAccentColor, toggleFavoriteShow } from "./profileAccents.mjs";
import { PROFILE_ACCENTS, PROFILE_FAVORITE_SHOWS_MAX as SERVER_MAX, PROFILE_PRONOUNS_MAX as SERVER_PRONOUNS_MAX } from "../../server/profileExtras.js";

test("the profile accents and limits match what the server accepts", () => {
  assert.deepEqual(PROFILE_ACCENT_OPTIONS.map((option) => option.id), PROFILE_ACCENTS);
  assert.equal(PROFILE_FAVORITE_SHOWS_MAX, SERVER_MAX);
  assert.equal(PROFILE_PRONOUNS_MAX, SERVER_PRONOUNS_MAX);
  assert.equal(profileAccentColor("violet"), "#9B7BFF");
  assert.equal(profileAccentColor("chartreuse"), null);
  assert.equal(profileAccentColor(undefined), null);
});

test("favorite shows: own show reviews, picked in order, four at most", () => {
  assert.equal(pinnableShow({ id: "a", artist: "Muna", kind: "review" }), true);
  assert.equal(pinnableShow({ id: "b", artist: "Muna", kind: "status" }), false);
  assert.equal(pinnableShow({ id: "c", news: { headline: "x" } }), false);
  assert.equal(pinnableShow({ id: "d", onlineTitle: "Tiny Desk" }), true);
  let pins = [];
  for (const id of ["a", "b", "c", "d", "e"]) pins = toggleFavoriteShow(pins, id);
  assert.deepEqual(pins, ["a", "b", "c", "d"], "a fifth pick is ignored");
  assert.deepEqual(toggleFavoriteShow(pins, "b"), ["a", "c", "d"]);
  assert.deepEqual(toggleFavoriteShow(null, "a"), ["a"]);
});
