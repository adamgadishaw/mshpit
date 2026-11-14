import assert from "node:assert/strict";
import test from "node:test";
import { projectIOSDetailPost, projectIOSDetailUser } from "./iosDetailPrivacyProjection.mjs";
import { mediaDisplayItems } from "./postMediaDisplay.mjs";

test("live iOS detail projection rejects removed fallback identity and blocked authors", () => {
  const post = { id: "post", userId: "author", review: "Private" };
  assert.equal(projectIOSDetailPost(post, { removedIds: ["post"] }), null);
  assert.equal(projectIOSDetailPost(post, { blockedIds: ["author"] }), null);
  assert.equal(projectIOSDetailPost({ id: "concert", postId: "post" }, { removedIds: ["post"] }), null);
  assert.equal(projectIOSDetailPost(post), post);
});

test("withdrawn canonical aliases and video posters never resurrect through descriptor fallback", () => {
  const post = { id: "post", photos: ["proxy", "video"], media: [
    { id: "one", uri: "proxy", sourceUrl: "original", kind: "image" },
    { id: "two", uri: "video", posterUri: "poster", kind: "video" },
  ] };
  const projected = projectIOSDetailPost(post, { isPhotoRemoved: uri => ["original", "poster"].includes(uri) });
  assert.deepEqual(projected.photos, []); assert.deepEqual(projected.media, []);
  assert.deepEqual(mediaDisplayItems(projected), []); assert.equal(post.photos.length, 2);
});

test("profile/news fallback artwork, blocked tags and map covers are projected consistently", () => {
  const isPhotoRemoved = uri => uri === "withdrawn";
  const post = { id: "post", photo: "withdrawn", taggedPeople: [{ id: "blocked" }, { id: "kept" }], cover: { postId: "removed", uri: "cover" },
    news: { headline: "Story", media: [{ url: "withdrawn", kind: "image" }], artists: [{ name: "Artist", photo: "withdrawn" }], sources: [{ kind: "photo", name: "Credit", url: "withdrawn" }] } };
  const result = projectIOSDetailPost(post, { isPhotoRemoved, removedIds: ["removed"], blockedIds: ["blocked"] });
  assert.equal(result.photo, null); assert.equal(result.cover, null); assert.deepEqual(result.taggedPeople, [{ id: "kept" }]);
  assert.deepEqual(result.news.media, []); assert.equal(result.news.artists[0].photo, null); assert.deepEqual(result.news.sources, []);
  assert.deepEqual(projectIOSDetailUser({ id: "user", banner: "withdrawn", avatarUri: "allowed" }, isPhotoRemoved), { id: "user", banner: null, avatarUri: "allowed" });
});
