import assert from "node:assert/strict";
import test from "node:test";
import {
  trackKey,
  trackMetadataKey,
  trackTupleKey,
  youtubeLookupCacheKey,
} from "./playback.js";

test("provider-neutral track keys include both artist and title", () => {
  assert.equal(trackKey({ artist: "Artist One", title: "Home" }), 'meta:["artist one","home"]');
  assert.notEqual(
    trackKey({ artist: "Artist One", title: "Home" }),
    trackKey({ artist: "Artist Two", title: "Home" }),
  );
  assert.notEqual(trackTupleKey("c", "a|b"), trackTupleKey("b|c", "a"));
  assert.notEqual(trackMetadataKey("c", "a|b"), trackMetadataKey("b|c", "a"));
  assert.notEqual(
    trackKey({ artist: "a|b", title: "c" }),
    trackKey({ artist: "a", title: "b|c" }),
    "the old delimiter collision cannot merge two songs",
  );
});

test("durable provider identities win over metadata", () => {
  assert.equal(trackKey({ id: 42, artist: "Artist", title: "Song" }), "id:42");
  assert.equal(trackKey({ url: "https://example.test/song", title: "Song" }), "url:https://example.test/song");
  assert.equal(trackKey(null), null);
});

test("YouTube lookup denials never cross authentication or account boundaries", () => {
  const title = "Auth Transition Song";
  const artist = "Auth Transition Artist";
  const anonymous = youtubeLookupCacheKey(title, artist, null);
  const unverifiedA = youtubeLookupCacheKey(title, artist, { id: "user-a", emailVerified: false });
  const verifiedA = youtubeLookupCacheKey(title, artist, { id: "user-a", emailVerified: true });
  const verifiedB = youtubeLookupCacheKey(title, artist, { id: "user-b", emailVerified: true });
  assert.notEqual(anonymous, verifiedA, "anonymous denial is not reused after login");
  assert.notEqual(unverifiedA, verifiedA, "verification immediately changes the lookup scope");
  assert.notEqual(verifiedA, verifiedB, "one account's daily denial cannot follow another account");
  assert.equal(
    youtubeLookupCacheKey(title, artist, { id: "user-a", emailVerified: true }),
    verifiedA,
    "one stable auth state still gets normal session-cache reuse",
  );
});
