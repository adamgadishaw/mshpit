import assert from "node:assert/strict";
import test from "node:test";

import { profileMediaItems } from "./profileMedia.mjs";

test("public profiles keep stable media descriptors and hide explicitly private post media", () => {
  const logs = [
    {
      id: "public-post",
      userId: "fan-1",
      photosPublic: true,
      photos: ["https://media.test/clip"],
      media: [{
        id: "ma_clip",
        kind: "video",
        url: "https://media.test/clip",
        posterUrl: "https://media.test/poster.jpg",
        altText: "The crowd singing the chorus",
      }],
    },
    { id: "private-post", userId: "fan-1", photosPublic: false, photos: ["https://media.test/private.jpg"] },
  ];
  const gallery = profileMediaItems(logs);
  assert.equal(gallery.length, 1);
  assert.equal(gallery[0].kind, "video");
  assert.equal(gallery[0].posterUrl, "https://media.test/poster.jpg");
  assert.equal(gallery[0].altText, "The crowd singing the chorus");
  assert.equal(gallery[0].postId, "public-post");
  assert.equal(gallery[0].ownerId, "fan-1");
});

test("owners see private legacy media while malformed input stays empty", () => {
  const gallery = profileMediaItems([{ id: "private-post", userId: "fan-1", photosPublic: false, photos: ["https://media.test/private.jpg"] }], { isSelf: true });
  assert.deepEqual(gallery, [{ uri: "https://media.test/private.jpg", postId: "private-post", ownerId: "fan-1" }]);
  assert.deepEqual(profileMediaItems(null), []);
});
