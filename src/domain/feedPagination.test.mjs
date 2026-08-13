import assert from "node:assert/strict";
import test from "node:test";
import { filteredFeedNextAction } from "./feedPagination.mjs";

test("filtered feeds reveal matches already in memory before fetching", () => {
  assert.equal(filteredFeedNextAction({
    filter: "following",
    visibleCount: 8,
    loadedMatchCount: 19,
    hasMore: true,
    loadingMore: false,
  }), "reveal");
});

test("filtered feeds fetch only after all loaded matches are visible", () => {
  assert.equal(filteredFeedNextAction({
    filter: "local",
    visibleCount: 8,
    loadedMatchCount: 8,
    hasMore: true,
    loadingMore: false,
  }), "fetch");
  assert.equal(filteredFeedNextAction({
    filter: "local",
    visibleCount: 8,
    loadedMatchCount: 8,
    hasMore: true,
    loadingMore: true,
  }), "none");
});

test("the everyone feed keeps using its normal end-reached path", () => {
  assert.equal(filteredFeedNextAction({
    filter: "everyone",
    visibleCount: 8,
    loadedMatchCount: 20,
    hasMore: true,
    loadingMore: false,
  }), "none");
});
