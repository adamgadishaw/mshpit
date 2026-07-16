import assert from "node:assert/strict";
import test from "node:test";
import { trackKey } from "./playback.js";

test("provider-neutral track keys include both artist and title", () => {
  assert.equal(trackKey({ artist: "Artist One", title: "Home" }), "meta:artist one|home");
  assert.notEqual(
    trackKey({ artist: "Artist One", title: "Home" }),
    trackKey({ artist: "Artist Two", title: "Home" }),
  );
});

test("durable provider identities win over metadata", () => {
  assert.equal(trackKey({ id: 42, artist: "Artist", title: "Song" }), "id:42");
  assert.equal(trackKey({ url: "https://example.test/song", title: "Song" }), "url:https://example.test/song");
  assert.equal(trackKey(null), null);
});
