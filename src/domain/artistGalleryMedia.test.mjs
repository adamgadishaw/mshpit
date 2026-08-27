import test from "node:test";
import assert from "node:assert/strict";

import {
  artistCinematicMedia,
  artistGalleryIdentityKey,
  boundedArtistGalleryMedia,
  isArtistGalleryMediaVisible,
  mergeArtistGalleryMedia,
  postMatchesArtistGallery,
} from "./artistGalleryMedia.mjs";

test("artist galleries prefer canonical identity over a shared display name", () => {
  assert.equal(artistGalleryIdentityKey("Twin Act", "twin-a"), "twin-a");
  assert.equal(postMatchesArtistGallery({ artist: "Twin Act", artistKey: "twin-a" }, { name: "Twin Act", artistKey: "twin-a" }), true);
  assert.equal(postMatchesArtistGallery({ artist: "Twin Act", artistKey: "twin-b" }, { name: "Twin Act", artistKey: "twin-a" }), false);
  assert.equal(postMatchesArtistGallery({ artist: "Twin Act" }, { name: "twin act" }), true);
});

test("blocked, removed and duplicate media cannot survive a gallery cache merge", () => {
  const rows = mergeArtistGalleryMedia(
    [{ uri: "https://media.example/a.jpg", ownerId: "u_good" }],
    [
      { uri: "https://media.example/a.jpg", ownerId: "u_good" },
      { uri: "https://media.example/b.jpg", ownerId: "u_blocked" },
      { uri: "https://media.example/c.jpg", ownerId: "u_good" },
    ],
    { blockedIds: ["u_blocked"], removedUris: ["https://media.example/c.jpg"] },
  );
  assert.deepEqual(rows.map((row) => row.uri), ["https://media.example/a.jpg"]);
});

test("artist gallery media fails closed for explicitly private, deleted, or moderated rows", () => {
  const privateRows = [
    { uri: "https://media.example/private.jpg", public: false },
    { uri: "https://media.example/opted-out.jpg", photosPublic: "0" },
    { uri: "https://media.example/deleted.jpg", deleted: "1" },
    { uri: "https://media.example/hidden.jpg", moderationStatus: "hidden" },
    { uri: "https://media.example/rejected.jpg", visibility: "rejected" },
  ];
  for (const row of privateRows) assert.equal(isArtistGalleryMediaVisible(row), false);
  assert.deepEqual(mergeArtistGalleryMedia(privateRows, []), []);
});

test("cinematic artist media is image-only, deduplicated, and tightly bounded", () => {
  const rows = artistCinematicMedia({
    bannerUri: "https://media.example/official.jpg",
    profileUri: "https://media.example/avatar.jpg",
    gallery: [
      { uri: "https://media.example/official.jpg", source: "fan" },
      { uri: "https://media.example/clip.mp4", source: "fan", kind: "video" },
      { uri: "https://media.example/private.jpg", source: "fan", photosPublic: false },
      ...Array.from({ length: 8 }, (_, index) => ({ uri: `https://media.example/fan-${index}.jpg`, source: "fan" })),
    ],
  }, 50);
  assert.equal(rows.length, 6);
  assert.equal(rows[0].uri, "https://media.example/official.jpg");
  assert.ok(rows.every((row) => !row.uri.endsWith(".mp4")));
  assert.equal(new Set(rows.map((row) => row.uri)).size, rows.length);
});

test("dedicated artist galleries remain bounded while retaining public clips", () => {
  const rows = boundedArtistGalleryMedia([
    { uri: "https://media.example/live.mp4", kind: "video" },
    ...Array.from({ length: 80 }, (_, index) => ({ uri: `https://media.example/${index}.jpg` })),
  ], 500);
  assert.equal(rows.length, 60);
  assert.equal(rows[0].kind, "video");
});
