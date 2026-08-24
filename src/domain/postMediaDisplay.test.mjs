import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  mediaDescriptorForUri,
  mediaDisplayItems,
  mediaDisplayKind,
  mediaDisplayUri,
  mediaPosterForUri,
  mediaPosterUri,
  sameMediaDisplayItems,
} from "./postMediaDisplay.mjs";

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

test("descriptor media type wins when a CDN URL has no file extension", () => {
  const clip = {
    kind: "video",
    url: "https://media.test/delivery/opaque-token",
    posterUrl: " https://media.test/delivery/opaque-poster ",
  };
  assert.equal(mediaDisplayKind(clip), "video");
  assert.equal(mediaDisplayKind({ mimeType: "video/mp4", url: "https://media.test/opaque" }), "video");
  assert.equal(mediaDisplayKind("https://media.test/archive.MOV?download=1"), "video");
  assert.equal(mediaDisplayKind({ kind: "image", url: "https://media.test/not-a-clip.mp4" }), "image");
  assert.equal(mediaPosterUri(clip), "https://media.test/delivery/opaque-poster");
  assert.equal(mediaPosterUri({ posterUri: "blob:local-cover" }), "blob:local-cover");
});

test("legacy source URLs reconcile to the current publishable descriptor", () => {
  const post = {
    photos: ["https://media.test/private/source-token"],
    media: [{
      id: "ma_delivery",
      kind: "video",
      url: "https://media.test/public/delivery-token",
      sourceUrl: "https://media.test/private/source-token",
      posterUrl: "https://media.test/public/poster-token",
    }],
  };
  const [item] = mediaDisplayItems(post);
  assert.equal(item.uri, "https://media.test/public/delivery-token");
  assert.equal(item.kind, "video");
  assert.equal(mediaPosterForUri(post, "https://media.test/private/source-token"), "https://media.test/public/poster-token");
});

test("feed reconciliation cannot preserve a stale URL-only card over fresh poster metadata", () => {
  const uri = "https://media.test/clip.mp4";
  const stale = { id: "post-1", photos: [uri], media: [] };
  const fresh = {
    id: "post-1",
    photos: [uri],
    media: [{ id: "ma_clip", kind: "video", url: uri, posterUrl: "https://media.test/poster.jpg" }],
  };
  assert.equal(sameMediaDisplayItems(stale, fresh), false);
  assert.equal(sameMediaDisplayItems(fresh, structuredClone(fresh)), true);
});

test("every public media surface consumes descriptor kind and durable poster metadata", () => {
  const smartImage = readFileSync(new URL("../components/SmartImage.jsx", import.meta.url), "utf8");
  const feedGrid = readFileSync(new URL("../components/PostMediaGrid.jsx", import.meta.url), "utf8");
  const viewer = readFileSync(new URL("../components/PhotoViewer.jsx", import.meta.url), "utf8");
  const clips = readFileSync(new URL("../screens/ClipsScreen.jsx", import.meta.url), "utf8");
  const profile = readFileSync(new URL("../screens/ProfileScreen.jsx", import.meta.url), "utf8");
  const discover = readFileSync(new URL("../components/discover/DiscoverCommunity.jsx", import.meta.url), "utf8");
  const artist = readFileSync(new URL("../screens/ArtistScreen.jsx", import.meta.url), "utf8");
  const you = readFileSync(new URL("../screens/YouScreen.jsx", import.meta.url), "utf8");
  const store = readFileSync(new URL("../store.js", import.meta.url), "utf8");

  assert.match(smartImage, /mediaKind === "video" \|\| \(!mediaKind && isVideoUrl\(uri\)\)/);
  assert.match(feedGrid, /mediaKind=\{mediaKind\}/);
  assert.match(viewer, /const video = mediaDisplayKind\(p\) === "video"/);
  assert.match(clips, /posterUri: mediaPosterUri\(descriptor\)/);
  assert.match(clips, /enabled=\{posterEnabled\}/);
  assert.match(profile, /const video = mediaDisplayKind\(item\) === "video"/);
  assert.match(discover, /const video = mediaDisplayKind\(photo\) === "video"/);
  assert.match(artist, /mediaKind=\{mediaDisplayKind\(p\)\}/);
  assert.doesNotMatch(you, /mediaDisplayItems|mediaDisplayKind|mediaPosterUri/, "the private You dashboard must not duplicate the public profile media wall");
  assert.match(store, /sameMediaDisplayItems\(a, b\)/);
});
