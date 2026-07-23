import assert from "node:assert/strict";
import test from "node:test";

import { recommendTracks, uniqueTracks } from "./recommend.mjs";

const artist = (name, genre, popularity, songs) => ({
  name, genre, popularity, art: `${name}.jpg`,
  tracks: songs.map((title, i) => ({ title, id: `${name}-${i}` })),
});

// A catalogue with enough shape to exercise taste, discovery and a back
// catalogue big enough to swamp the queue if nothing capped it.
const CATALOG = [
  artist("Prolific Punk", "punk", 90, ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"]),
  artist("Second Punk", "punk", 80, ["S1", "S2", "S3"]),
  artist("Third Punk", "punk", 70, ["T1", "T2"]),
  artist("Fourth Punk", "punk", 60, ["F1", "F2"]),
  artist("Jazz One", "jazz", 85, ["J1", "J2"]),
  artist("Jazz Two", "jazz", 75, ["K1", "K2"]),
  artist("Pop One", "pop", 95, ["O1", "O2"]),
  artist("Pop Two", "pop", 65, ["Q1", "Q2"]),
];

const titles = (list) => list.map((t) => t.title);

test("one prolific artist cannot dominate the queue", () => {
  const out = recommendTracks({ candidates: CATALOG, genre: "punk", count: 20 });
  const counts = {};
  for (const t of out) counts[t.artist] = (counts[t.artist] || 0) + 1;
  for (const [name, n] of Object.entries(counts)) {
    assert.ok(n <= 2, `${name} took ${n} slots, the cap is 2`);
  }
  assert.ok(Object.keys(counts).length >= 4, "a queue should span several artists");
});

test("two sessions do not open with the same run of songs", () => {
  const first = titles(recommendTracks({ candidates: CATALOG, genre: "punk", count: 8, rotation: 0 }));
  const second = titles(recommendTracks({ candidates: CATALOG, genre: "punk", count: 8, rotation: 1 }));
  const third = titles(recommendTracks({ candidates: CATALOG, genre: "punk", count: 8, rotation: 2 }));
  assert.notDeepEqual(first.slice(0, 4), second.slice(0, 4));
  assert.notDeepEqual(second.slice(0, 4), third.slice(0, 4));
  assert.notDeepEqual(first.slice(0, 4), third.slice(0, 4));
});

test("recently played tracks are deferred, by title as well as by id", () => {
  const history = [
    { artist: "Prolific Punk", title: "P1", id: "Prolific Punk-0" },
    // Same recording, different provider id: matching on id alone would let
    // this straight back into the queue.
    { artist: "Second Punk", title: "S1", id: "some-other-provider-id" },
  ];
  const out = recommendTracks({ candidates: CATALOG, genre: "punk", count: 20, history });
  assert.equal(out.some((t) => t.artist === "Prolific Punk" && t.title === "P1"), false);
  assert.equal(out.some((t) => t.artist === "Second Punk" && t.title === "S1"), false);
});

test("a recently heard artist sinks but is not banned outright", () => {
  const history = [{ artist: "Prolific Punk", title: "P1", id: "x" }];
  const out = recommendTracks({ candidates: CATALOG, genre: "punk", count: 20, history });
  const first = out.findIndex((t) => t.artist === "Prolific Punk");
  assert.ok(first === -1 || first > 0, "a just-heard artist should not open the next queue");
});

test("the seed itself never comes back as a recommendation", () => {
  const seed = { artist: "Pop One", title: "O1", id: "Pop One-0" };
  const out = recommendTracks({ candidates: CATALOG, genre: "pop", count: 20, seed });
  assert.equal(out.some((t) => t.artist === "Pop One" && t.title === "O1"), false);
});

test("the queue leaves the seed's genre, so taste does not become a rut", () => {
  const out = recommendTracks({ candidates: CATALOG, genre: "punk", count: 12 });
  assert.ok(out.some((t) => !["Prolific Punk", "Second Punk", "Third Punk", "Fourth Punk"].includes(t.artist)),
    "a queue should include discovery outside the seed genre");
});

test("exact recording identity survives into the queue", () => {
  const rich = [{
    name: "Exact", genre: "pop", popularity: 50, art: "a.jpg",
    tracks: [{ title: "Song", id: "dz-1", videoId: "yt-abc", provider: "youtube", url: "https://y/1", preview: "https://p/1", duration: 210 }],
  }];
  const [track] = recommendTracks({ candidates: rich, genre: "pop", count: 1 });
  assert.equal(track.videoId, "yt-abc");
  assert.equal(track.id, "dz-1");
  assert.equal(track.provider, "youtube");
  assert.equal(track.duration, 210);
  assert.equal(track.preview, "https://p/1");
});

test("a sparse or empty account still gets a truthful answer, never a crash", () => {
  assert.deepEqual(recommendTracks({}), []);
  assert.deepEqual(recommendTracks({ candidates: [], genre: "punk" }), []);
  // Artists with no playable tracks are not offered as if they had some.
  assert.deepEqual(recommendTracks({ candidates: [{ name: "Empty", tracks: [] }] }), []);
  // No genre at all: everything is discovery, and it still returns music.
  assert.ok(recommendTracks({ candidates: CATALOG, count: 5 }).length > 0);
});

test("a custom trackKey participates in de-duplication", () => {
  const trackKey = (t) => (t?.id ? `id:${t.id}` : null);
  const history = [{ artist: "Anything", title: "Anything", id: "Pop One-0" }];
  const out = recommendTracks({ candidates: CATALOG, genre: "pop", count: 20, history, trackKey });
  assert.equal(out.some((t) => t.id === "Pop One-0"), false, "the provider id should have been recognised");
});

test("recent listening collapses repeats without touching the underlying history", () => {
  // The exact shape from the owner's screenshot: two plays each of two songs.
  const history = [
    { artist: "Nickelback", title: "Animals", id: "n-1" },
    { artist: "Nickelback", title: "Burn It to the Ground", id: "n-2" },
    { artist: "Nickelback", title: "Animals", id: "n-1" },
    { artist: "Nickelback", title: "Someday", id: "n-3" },
    { artist: "Nickelback", title: "Burn It to the Ground", id: "n-2" },
  ];
  const shown = uniqueTracks(history);
  assert.deepEqual(shown.map((t) => t.title), ["Animals", "Burn It to the Ground", "Someday"]);
  assert.equal(history.length, 5, "the source history is untouched, so play counts still work");
});

test("the same recording under two provider ids collapses to one row", () => {
  const shown = uniqueTracks([
    { artist: "K-Ci & JoJo", title: "All My Life", id: "dz-1" },
    { artist: "K-Ci & JoJo", title: "All My Life", id: "yt-2" },
  ]);
  assert.equal(shown.length, 1);
});
