import assert from "node:assert/strict";
import test from "node:test";
import { createArtistReviewService } from "./artistReviewService.js";

test("service attaches viewer likes once to the ordered review page before canonical projection", () => {
  const rows = [
    { id: "review-c", review: "Third", photos_public: 0 },
    { id: "review-a", review: "First", photos_public: 0 },
    { id: "review-b", review: "Second", photos_public: 0 },
  ];
  const repositoryCalls = [];
  const likeCalls = [];
  const projectedRows = [];
  const repository = {
    findTopReviews(options) {
      repositoryCalls.push(options);
      return rows;
    },
  };
  const service = createArtistReviewService({
    repository,
    attachViewerLikes(page, viewerId) {
      likeCalls.push({ page, viewerId });
      return page.map((row) => ({
        ...row,
        viewer_liked: row.id === "review-a" ? 1 : 0,
      }));
    },
    projectPost(row, viewerId) {
      projectedRows.push({ row, viewerId });
      return {
        id: row.id,
        review: row.review,
        photosPublic: !!row.photos_public,
        liked: !!row.viewer_liked,
      };
    },
  });

  const reviews = service.readTopReviews({
    artistKey: "alpha",
    name: "Alpha",
    viewerId: "viewer",
    limit: 99,
  });

  assert.deepEqual(repositoryCalls, [{
    artistKey: "alpha",
    name: "Alpha",
    viewerId: "viewer",
    limit: 10,
  }]);
  assert.equal(likeCalls.length, 1);
  assert.equal(likeCalls[0].page, rows);
  assert.equal(likeCalls[0].viewerId, "viewer");
  assert.deepEqual(projectedRows.map(({ row }) => row.id), ["review-c", "review-a", "review-b"]);
  assert.ok(projectedRows.every(({ viewerId }) => viewerId === "viewer"));
  assert.deepEqual(reviews.map(({ id, liked }) => ({ id, liked })), [
    { id: "review-c", liked: false },
    { id: "review-a", liked: true },
    { id: "review-b", liked: false },
  ]);
});

test("service can project the artist review page as one batch", () => {
  const rows = [
    { id: "review-a", review: "First", photos_public: 1 },
    { id: "review-b", review: "Second", photos_public: 1 },
  ];
  const pageCalls = [];
  const service = createArtistReviewService({
    repository: { findTopReviews: () => rows },
    attachViewerLikes: (page) => page,
    projectPost() {
      throw new Error("the per-row fallback must not run when a page projector is supplied");
    },
    projectPosts(page, viewerId) {
      pageCalls.push({ page, viewerId });
      return page.map((row) => ({
        id: row.id,
        review: row.review,
        photosPublic: true,
        photos: [],
        media: [],
        mediaAssetIds: [],
      }));
    },
  });

  assert.deepEqual(service.readTopReviews({ artistKey: "alpha", viewerId: "viewer" }).map((row) => row.id), [
    "review-a",
    "review-b",
  ]);
  assert.equal(pageCalls.length, 1);
  assert.equal(pageCalls[0].page, rows);
  assert.equal(pageCalls[0].viewerId, "viewer");
});
