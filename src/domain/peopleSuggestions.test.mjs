import test from "node:test";
import assert from "node:assert/strict";
import { peopleSuggestionDistanceKm, rankPeopleSuggestions } from "./peopleSuggestions.mjs";

const viewer = {
  id: "me",
  home: { city: "Toronto", lat: 43.6532, lng: -79.3832 },
  genres: ["R&B", "Hip-Hop"],
  favoriteArtists: ["Bryson Tiller", "Drake"],
};

test("people suggestions blend broad proximity with explicit shared taste", () => {
  const ranked = rankPeopleSuggestions({
    viewer,
    candidates: [
      { id: "near", name: "Near", home: { city: "Toronto", lat: 43.66, lng: -79.39 }, genres: [], favoriteArtists: [], showCount: 1 },
      { id: "match", name: "Match", home: { city: "Mississauga", lat: 43.59, lng: -79.64 }, genres: ["R&B"], favoriteArtists: ["Bryson Tiller"], showCount: 4 },
      { id: "far", name: "Far", home: { city: "Lisbon", lat: 38.72, lng: -9.14 }, genres: ["R&B"], favoriteArtists: ["Bryson Tiller"], showCount: 20 },
    ],
  });

  assert.deepEqual(ranked.map((person) => person.id), ["match", "near", "far"]);
  assert.equal(ranked[0].reason, "Mississauga · Also likes Bryson Tiller");
  assert.ok(ranked[0].distanceKm > 0);
});

test("people suggestions fall back to city and activity without coordinates", () => {
  const ranked = rankPeopleSuggestions({
    viewer: { ...viewer, home: { city: "Toronto" } },
    candidates: [
      { id: "elsewhere", name: "Elsewhere", home: { city: "Ottawa" }, genres: [], favoriteArtists: [], showCount: 20 },
      { id: "local", name: "Local", home: { city: "Toronto" }, genres: [], favoriteArtists: [], showCount: 2 },
    ],
  });
  assert.deepEqual(ranked.map((person) => person.id), ["local", "elsewhere"]);
  assert.equal(ranked[0].reason, "Toronto · 2 shows logged");
});

test("people suggestions are bounded and never include the viewer", () => {
  const candidates = Array.from({ length: 30 }, (_, index) => ({
    id: index === 0 ? "me" : `u-${index}`,
    name: `User ${index}`,
    home: { city: "Toronto", lat: 43.65 + index / 1000, lng: -79.38 },
  }));
  const ranked = rankPeopleSuggestions({ viewer, candidates, limit: 5 });
  assert.equal(ranked.length, 5);
  assert.equal(ranked.some((person) => person.id === viewer.id), false);
  assert.ok(peopleSuggestionDistanceKm(viewer.home, ranked[0].home) >= 0);
});
