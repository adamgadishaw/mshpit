import assert from "node:assert/strict";
import test from "node:test";
import {
  playerResolutionKey,
  trackKey,
  trackMetadataKey,
  trackTupleKey,
  youtubeLookupCacheKey,
} from "./trackIdentity.mjs";

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
  assert.notEqual(trackKey(solo), trackKey({ ...solo, provider: "spotify" }));
  assert.notEqual(trackKey({ ...solo, sourceId: "AbC" }), trackKey({ ...solo, sourceId: "abc" }));
  assert.equal(trackKey({ sourceId: "1124841682", artist: "Artist", title: "Song" }), 'meta:["artist","song"]');
  assert.equal(trackKey({ ...solo, id: 1124841682 }), trackKey(solo));
});

test("exact video, provider source, and generic id precedence stays stable", () => {
  const source = { provider: "deezer", sourceId: "1124841682", artist: "Artist", title: "Song" };
  assert.equal(trackKey({ ...source, id: 42, videoId: "ABCDEFGHIJK" }), "youtube:ABCDEFGHIJK");
  assert.equal(trackKey({ ...source, id: 42 }), 'source:["deezer","1124841682"]');
  assert.equal(trackKey({ id: 42, artist: "Artist", title: "Song" }), "id:42");
  assert.equal(trackKey({ url: "https://example.test/song", title: "Song" }), "url:https://example.test/song");
  assert.equal(trackKey({ preview: "https://example.test/preview", title: "Song" }), "preview:https://example.test/preview");
  assert.equal(trackKey(null), null);
});

test("adjacent duplicate queue occurrences get independent playback generations", () => {
  const track = { queueEntryId: "occurrence-1", provider: "deezer", sourceId: "1124841682", videoId: "ABCDEFGHIJK" };
  const account = { id: "listener-1", emailVerified: true };
  const first = playerResolutionKey({ track, account });
  const second = playerResolutionKey({ track: { ...track, queueEntryId: "occurrence-2" }, account });
  assert.notEqual(first, second);
  assert.equal(first, playerResolutionKey({ track: { ...track }, account }));
});

test("YouTube lookup denials never cross authentication, account, or recording boundaries", () => {
  const title = "Auth Transition Song";
  const artist = "Auth Transition Artist";
  const anonymous = youtubeLookupCacheKey(title, artist, null);
  const unverifiedA = youtubeLookupCacheKey(title, artist, { id: "user-a", emailVerified: false });
  const verifiedA = youtubeLookupCacheKey(title, artist, { id: "user-a", emailVerified: true });
  const verifiedB = youtubeLookupCacheKey(title, artist, { id: "user-b", emailVerified: true });
  assert.notEqual(anonymous, verifiedA);
  assert.notEqual(unverifiedA, verifiedA);
  assert.notEqual(verifiedA, verifiedB);
  assert.notEqual(
    youtubeLookupCacheKey(title, artist, { id: "user-a", emailVerified: true }, { provider: "deezer", sourceId: "1124841682" }),
    youtubeLookupCacheKey(title, artist, { id: "user-a", emailVerified: true }, { provider: "deezer", sourceId: "1234638792" }),
  );
});
