import test from "node:test";
import assert from "node:assert/strict";

import {
  artistGalleryIdentityKey,
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
