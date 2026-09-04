import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeSuccessfulArtistPhotoMirrors,
  parseArtistPhotoMirrorArgs,
  selectArtistPhotoMirrorRows,
} from "./artist-photo-mirror-batch.mjs";

const bryson = Object.freeze({
  artistKey: "bryson tiller",
  mbid: "d8fd8d9b-473b-4f06-83c8-869b1bb9de89",
  photo: Object.freeze({ uri: "https://upload.wikimedia.org/bryson.png" }),
});

test("artist-photo mirror arguments select one exact canonical source row", () => {
  const options = parseArtistPhotoMirrorArgs(["--dry-run", "--artist= Bryson   Tiller "]);
  assert.deepEqual(options, { dryRun: true, artist: "bryson tiller" });
  const rows = selectArtistPhotoMirrorRows({
    "another artist": {
      artistKey: "another artist",
      mbid: null,
      photo: { uri: "https://upload.wikimedia.org/another.jpg" },
    },
    "bryson tiller": bryson,
  }, options);
  assert.deepEqual(rows.map(({ key }) => key), ["bryson tiller"]);
  assert.throws(
    () => selectArtistPhotoMirrorRows({ "bryson tiller": bryson }, { artist: "bryson" }),
    /Unknown artist-photo source key/u,
  );
  assert.throws(() => parseArtistPhotoMirrorArgs(["--all"]), /Unknown artist-photo mirror argument/u);
  assert.throws(
    () => parseArtistPhotoMirrorArgs(["--artist=bryson tiller", "--artist=another artist"]),
    /only once/u,
  );
});

test("successful mirror output replaces only successful rows and preserves failed rows", () => {
  const oldBryson = {
    artistKey: "bryson tiller",
    mbid: bryson.mbid,
    photo: { uri: "https://media.mshpit.example/artists/licensed/bryson-old.webp" },
  };
  const existing = {
    "bryson tiller": oldBryson,
    "another artist": {
      artistKey: "another artist",
      mbid: null,
      photo: { uri: "https://media.mshpit.example/artists/licensed/another-old.webp" },
    },
  };
  const replacement = { uri: "https://media.mshpit.example/artists/licensed/another-new.webp" };
  const next = mergeSuccessfulArtistPhotoMirrors(existing, [{
    key: "another artist",
    artistKey: "another artist",
    mbid: null,
    photo: replacement,
  }]);

  assert.deepEqual(next["bryson tiller"], oldBryson,
    "a selected row that did not produce a success retains its previous verified entry");
  assert.deepEqual(next["another artist"].photo, replacement);
  assert.deepEqual(existing["another artist"].photo, {
    uri: "https://media.mshpit.example/artists/licensed/another-old.webp",
  }, "merging does not mutate the last known-good catalog");
});

test("authoritative source keys revoke removed rows while retaining present refresh failures", () => {
  const existing = {
    "bryson tiller": { artistKey: "bryson tiller", mbid: bryson.mbid, photo: { uri: "old-bryson" } },
    "revoked artist": { artistKey: "revoked artist", mbid: null, photo: { uri: "must-disappear" } },
  };
  const next = mergeSuccessfulArtistPhotoMirrors(existing, [], {
    authoritativeKeys: ["bryson tiller"],
  });
  assert.deepEqual(next, {
    "bryson tiller": existing["bryson tiller"],
  }, "a source row whose refresh failed remains, but an absent source row is revoked");
  assert.throws(
    () => mergeSuccessfulArtistPhotoMirrors(existing, [], { authoritativeKeys: [" Bryson Tiller "] }),
    /canonical/u,
  );
});
