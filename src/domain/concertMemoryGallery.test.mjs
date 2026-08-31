import assert from "node:assert/strict";
import test from "node:test";
import { concertMemoryGallery } from "./concertMemoryGallery.mjs";

test("memory gallery keeps every owner item first and deduplicates community media", () => {
  const gallery = concertMemoryGallery({
    id: "mine",
    photos: ["https://media.test/one.jpg", "https://media.test/two.jpg"],
  }, [
    {
      id: "mine",
      userId: "me",
      user: { name: "Me" },
      photos: ["https://media.test/one.jpg"],
    },
    {
      id: "other",
      userId: "other-user",
      user: { name: "Fan" },
      photos: ["https://media.test/three.jpg"],
    },
  ]);

  assert.deepEqual(gallery.map((item) => item.uri), [
    "https://media.test/one.jpg",
    "https://media.test/two.jpg",
    "https://media.test/three.jpg",
  ]);
  assert.equal(gallery[0].by, "Your post");
  assert.equal(gallery[2].by, "Fan");
});

test("memory gallery is bounded and ignores unusable media", () => {
  const reviews = Array.from({ length: 30 }, (_, index) => ({
    id: "post-" + index,
    user: { name: "Fan " + index },
    photos: ["https://media.test/" + index + ".jpg"],
  }));
  assert.equal(concertMemoryGallery({}, reviews).length, 12);
  assert.deepEqual(concertMemoryGallery({}, [{ id: "bad", photos: [""] }]), []);
});

test("a closed memory modal has an empty gallery instead of crashing You", () => {
  assert.deepEqual(concertMemoryGallery(null, null), []);
});
