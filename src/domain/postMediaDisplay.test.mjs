import assert from "node:assert/strict";
import test from "node:test";
import { mediaDescriptorForUri, mediaDisplayItems, mediaDisplayUri, mediaPosterForUri } from "./postMediaDisplay.mjs";

test("stable descriptors enrich the legacy media order with durable posters", () => {
  const post = {
    photos: ["https://media.test/b.mp4", "https://media.test/a.jpg"],
    media: [
      { id: "ma_a", url: "https://media.test/a.jpg", altText: "Crowd at the encore" },
      { id: "ma_b", url: "https://media.test/b.mp4", posterUrl: "https://media.test/b-poster.jpg", altText: "Crowd beneath the amber stage lights" },
    ],
  };
  const items = mediaDisplayItems(post);
  assert.deepEqual(items.map((item) => item.id), ["ma_b", "ma_a"]);
  assert.equal(items[0].posterUrl, "https://media.test/b-poster.jpg");
  assert.equal(items[1].altText, "Crowd at the encore");
  assert.equal(mediaPosterForUri(post, post.photos[0]), "https://media.test/b-poster.jpg");
  assert.equal(mediaDescriptorForUri(post, post.photos[0])?.altText, "Crowd beneath the amber stage lights");
});

test("legacy URL-only posts and descriptor-only projections remain displayable", () => {
  assert.deepEqual(mediaDisplayItems({ photos: ["https://media.test/legacy.mov"] }), [
    { uri: "https://media.test/legacy.mov" },
  ]);
  assert.equal(mediaDisplayItems({ media: [{ url: "https://media.test/new.webp" }] })[0].uri, "https://media.test/new.webp");
  assert.equal(mediaDisplayUri({ sourceUrl: "https://media.test/source.jpg" }), "https://media.test/source.jpg");
});
