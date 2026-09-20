import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalArtistIdentity,
  canonicalArtistIdentityScope,
} from "./canonicalArtistIdentity.mjs";

test("attached artist keys remain authoritative", () => {
  assert.deepEqual(canonicalArtistIdentity({
    artistName: "The Roots",
    artistKey: "artist/the-roots",
    catalogArtist: { name: "The Roots", key: "wrong" },
  }), {
    artistName: "The Roots",
    artistKey: "artist/the-roots",
  });
});

test("name-only archive targets adopt a matching persisted catalogue identity", () => {
  assert.deepEqual(canonicalArtistIdentity({
    artistName: "  Earth, Wind & Fire ",
    catalogArtist: { name: "Earth, Wind & Fire", key: "earth-wind-fire", publicSlug: "earth-wind-fire" },
  }), {
    artistName: "Earth, Wind & Fire",
    artistKey: "earth-wind-fire",
  });
});

test("display names, slugs, and mismatched candidates never manufacture an identity", () => {
  assert.deepEqual(canonicalArtistIdentity({ artistName: "Legacy Name" }), {
    artistName: "Legacy Name",
    artistKey: null,
  });
  assert.deepEqual(canonicalArtistIdentity({
    artistName: "Twin Act",
    catalogArtist: { name: "Different Twin Act", key: "different", publicSlug: "twin-act" },
  }), {
    artistName: "Twin Act",
    artistKey: null,
  });
});

test("identity scopes normalize harmless display differences", () => {
  assert.equal(
    canonicalArtistIdentityScope({ artistName: " Earth,  Wind & Fire ", artistKey: " ARTIST/KEY " }),
    "earth, wind & fire:artist/key",
  );
});

test("provider previews never become persisted identity proof but explicit attached keys survive", () => {
  const catalogArtist = { name: "Imran Khan", key: "imran khan", publicSlug: "imran-khan", transient: true };
  assert.deepEqual(canonicalArtistIdentity({ artistName: "Imran Khan", catalogArtist }), {
    artistName: "Imran Khan", artistKey: null,
  });
  assert.deepEqual(canonicalArtistIdentity({ artistName: "Imran Khan", artistKey: "stored-event-artist", catalogArtist }), {
    artistName: "Imran Khan", artistKey: "stored-event-artist",
  });
  assert.deepEqual(canonicalArtistIdentity({ artistName: "Imran Khan", catalogArtist: { ...catalogArtist, transient: false } }), {
    artistName: "Imran Khan", artistKey: "imran khan",
  });
});
