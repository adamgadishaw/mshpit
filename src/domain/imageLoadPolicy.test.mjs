import assert from "node:assert/strict";
import test from "node:test";

import { imageLoadPolicy, versionedImageCacheKey } from "./imageLoadPolicy.mjs";

test("ordinary images are lazy while visible and high-priority images start immediately", () => {
  assert.deepEqual(imageLoadPolicy(), {
    priority: "normal",
    loading: "lazy",
    autoplay: true,
    transition: 80,
  });
  assert.deepEqual(imageLoadPolicy({ priority: "high" }), {
    priority: "high",
    loading: "eager",
    autoplay: true,
    transition: 80,
  });
  assert.equal(imageLoadPolicy({ loading: "eager" }).loading, "eager", "an explicit caller decision wins");
});

test("explicitly hidden images yield network and animation work", () => {
  assert.deepEqual(imageLoadPolicy({ viewable: false }), {
    priority: "low",
    loading: "lazy",
    autoplay: false,
    transition: 0,
  });
});

test("versioned cache identity survives URL refreshes and changes with profile updates", () => {
  const one = versionedImageCacheKey({
    namespace: "avatar",
    id: "user 1",
    version: 1700000000000,
    variant: "128:0",
    uri: "https://media.example/avatar.jpg?token=one",
  });
  const refreshed = versionedImageCacheKey({
    namespace: "avatar",
    id: "user 1",
    version: 1700000000000,
    variant: "128:0",
    uri: "https://media.example/avatar.jpg?token=two",
  });
  const updated = versionedImageCacheKey({
    namespace: "avatar",
    id: "user 1",
    version: 1700000000001,
    variant: "128:0",
    uri: "https://media.example/avatar.jpg?token=three",
  });
  assert.equal(one, refreshed);
  assert.notEqual(one, updated);
  assert.equal(versionedImageCacheKey({ id: "user 1", uri: "https://media.example/a.jpg" }), "https://media.example/a.jpg");
});
