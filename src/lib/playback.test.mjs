import assert from "node:assert/strict";
import test from "node:test";
import {
  playerResolutionKey,
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

test("provider source identities distinguish same-metadata recordings", () => {
  const solo = { provider: " Deezer ", sourceId: " 1124841682 ", artist: "Artist", title: "Song" };
  const feature = { provider: "deezer", sourceId: "1234638792", artist: "Artist", title: "Song" };
  assert.equal(trackKey(solo), 'source:["deezer","1124841682"]');
  assert.notEqual(trackKey(solo), trackKey(feature), "solo and feature provider records cannot share player resolution");
  assert.equal(
    trackKey(solo),
    trackKey({ ...solo, provider: "DEEZER", sourceId: "1124841682" }),
    "provider casing and surrounding ID whitespace normalize to one recording",
  );
  assert.notEqual(
    trackKey(solo),
    trackKey({ ...solo, provider: "spotify" }),
    "the same opaque source ID from another provider is a different identity",
  );
  assert.notEqual(
    trackKey({ ...solo, sourceId: "AbC" }),
    trackKey({ ...solo, sourceId: "abc" }),
    "opaque provider IDs remain case-sensitive",
  );
  assert.equal(
    trackKey({ sourceId: "1124841682", artist: "Artist", title: "Song" }),
    'meta:["artist","song"]',
    "an opaque source ID without its provider cannot become a global identity",
  );
  assert.equal(
    trackKey({ ...solo, id: 1124841682 }),
    trackKey(solo),
    "a raw Deezer row and its persisted provider descriptor keep one identity",
  );
});

test("exact video, provider source, and generic id precedence stays stable", () => {
  const source = { provider: "deezer", sourceId: "1124841682", artist: "Artist", title: "Song" };
  assert.equal(
    trackKey({ ...source, id: 42, videoId: "ABCDEFGHIJK", url: "https://example.test/video" }),
    "youtube:ABCDEFGHIJK",
  );
  assert.equal(
    trackKey({ ...source, id: 42, url: "https://example.test/video" }),
    'source:["deezer","1124841682"]',
  );
  assert.equal(trackKey(source), 'source:["deezer","1124841682"]');
  assert.equal(trackKey({ id: 42, artist: "Artist", title: "Song" }), "id:42");
  assert.equal(trackKey({ url: "https://example.test/song", title: "Song" }), "url:https://example.test/song");
  assert.equal(trackKey({ preview: "https://example.test/preview", title: "Song" }), "preview:https://example.test/preview");
  assert.equal(trackKey(null), null);
});

test("adjacent duplicate queue occurrences get independent playback generations", () => {
  const track = {
    queueEntryId: "occurrence-1",
    provider: "deezer",
    sourceId: "1124841682",
    videoId: "ABCDEFGHIJK",
    artist: "Artist",
    title: "Song",
  };
  const user = { id: "listener-1", emailVerified: true };
  const first = playerResolutionKey({ track, user });
  const second = playerResolutionKey({ track: { ...track, queueEntryId: "occurrence-2" }, user });
  assert.notEqual(first, second, "auto-advance must restart duplicate occurrence two from its own media generation");
  assert.equal(first, playerResolutionKey({ track: { ...track }, user }), "rerenders keep one occurrence stable");
  assert.equal(new Set([first, second]).size, 2, "each duplicate occurrence can record one playback start");
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
  assert.notEqual(
    youtubeLookupCacheKey(title, artist, { id: "user-a", emailVerified: true }, { provider: "deezer", sourceId: "1124841682" }),
    youtubeLookupCacheKey(title, artist, { id: "user-a", emailVerified: true }, { provider: "deezer", sourceId: "1234638792" }),
    "two provider recordings with the same display title never share a resolver outcome",
  );
});
