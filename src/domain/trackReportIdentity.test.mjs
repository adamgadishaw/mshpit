import assert from "node:assert/strict";
import test from "node:test";
import { trackReportDescriptor, trackReportIdentityKey } from "./trackReportIdentity.mjs";

test("song report identity keeps same-display provider recordings separate", () => {
  const solo = { title: "Shared Recording", artist: "Artist", provider: "Deezer", sourceId: 1124841682 };
  const feature = { ...solo, sourceId: 1234638792 };
  assert.deepEqual(trackReportDescriptor(solo), {
    title: "Shared Recording",
    artist: "Artist",
    provider: "deezer",
    sourceId: "1124841682",
  });
  assert.notEqual(trackReportIdentityKey(solo), trackReportIdentityKey(feature));
  assert.notEqual(
    trackReportIdentityKey({ ...solo, provider: "spotify" }),
    trackReportIdentityKey(solo),
  );
});

test("song report identity falls back safely when no provider source exists", () => {
  assert.deepEqual(trackReportDescriptor({ title: " Legacy Song " }, " Artist "), {
    title: "Legacy Song",
    artist: "Artist",
    provider: null,
    sourceId: null,
  });
  assert.equal(
    trackReportIdentityKey({ title: "Legacy Song", artist: "Artist" }),
    trackReportIdentityKey({ title: " Legacy Song ", artist: " Artist " }),
  );
});
