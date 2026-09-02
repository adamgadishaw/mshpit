import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const auth = read("../screens/AuthScreen.jsx");
const editProfile = read("../screens/EditProfileScreen.jsx");
const pickArtists = read("../screens/PickArtistsScreen.jsx");
const discoverGenres = read("../components/discover/DiscoverGenres.jsx");

test("signup and Edit Profile expose the same required one-to-three genre contract", () => {
  assert.match(auth, /Choose 1 to 3 genres/);
  assert.match(auth, /genres: genreSelection\.genres/);
  assert.match(auth, /PROFILE_GENRE_MAX/);
  assert.match(editProfile, /profileGenreSelection\(genres\)/);
  assert.match(editProfile, /disabled: mediaBusy \|\| saving \|\| !genreSelection\.valid/);
  assert.match(editProfile, /profileGenreOptions\(genres, GENRES\)/);
});

test("artist picks no longer silently rewrite explicit genre preferences", () => {
  assert.match(pickArtists, /updateProfile\(\{ favoriteArtists \}\)/);
  assert.doesNotMatch(pickArtists, /genres\.add\(/);
  assert.doesNotMatch(pickArtists, /updateProfile\(\{ favoriteArtists, genres/);
});

test("Discover labels MSHpit live ratings separately from catalog popularity", () => {
  assert.match(discoverGenres, /TOP REVIEWED LIVE/);
  assert.match(discoverGenres, /ratingCount/);
  assert.match(discoverGenres, /Popular catalog artists with a verified genre/);
  assert.match(discoverGenres, /one perfect score does not automatically win/);
});
