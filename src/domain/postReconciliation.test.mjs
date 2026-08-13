import assert from "node:assert/strict";
import test from "node:test";
import { postMatchesEditIntent, shouldReconcileEditFailure } from "./postReconciliation.mjs";

const canonical = {
  id: "p1",
  artist: "J. Cole",
  artistKey: null,
  venue: "Scotiabank Arena",
  city: "Toronto",
  date: "2026-07-28",
  overall: 4.5,
  band: 5,
  room: null,
  dims: { performance: 5, sound: 4 },
  review: "Worth the wait",
  photos: ["https://cdn.example/jcole.jpg"],
  photosPublic: false,
  setlist: ["Opener"],
  tour: null,
  tags: ["hip-hop"],
  song: { videoId: "dQw4w9WgXcQ", title: "Song", artist: "J. Cole" },
  playlist: null,
};

test("edit reconciliation accepts an already-committed canonical review", () => {
  assert.equal(postMatchesEditIntent(canonical, {
    artist: " J. Cole ",
    artistKey: null,
    venue: "Scotiabank Arena",
    city: "Toronto",
    date: "2026 / 07 / 28",
    overall: "4.5",
    band: "5",
    room: null,
    dims: { sound: "4", performance: 5, privileged: 5 },
    review: "  Worth the wait  ",
    photos: ["https://cdn.example/jcole.jpg"],
    photosPublic: 0,
    setlist: ["Opener"],
    tour: null,
    tags: ["hip-hop", "hip-hop"],
    song: { videoId: "dQw4w9WgXcQ", title: "Song", artist: "J. Cole" },
    version: 100,
  }), true);
});

test("edit reconciliation rejects a real conflict or unknown write field", () => {
  assert.equal(postMatchesEditIntent(canonical, { review: "Different", version: 100 }), false);
  assert.equal(postMatchesEditIntent(canonical, { review: canonical.review, removed: true, version: 100 }), false);
  assert.equal(postMatchesEditIntent(null, { review: canonical.review }), false);
});

test("edit reconciliation never coerces malformed canonical response fields into a match", () => {
  assert.equal(postMatchesEditIntent({ ...canonical, photos: "not-an-array" }, { photos: [], version: 100 }), false);
  assert.equal(postMatchesEditIntent({ ...canonical, dims: [] }, { dims: {}, version: 100 }), false);
  assert.equal(postMatchesEditIntent({ ...canonical, overall: "4.5" }, { overall: 4.5, version: 100 }), false);
  assert.equal(postMatchesEditIntent({ ...canonical, playlist: "pl_1" }, { playlistId: "pl_1", version: 100 }), false);
  assert.equal(postMatchesEditIntent({ ...canonical, song: { title: "missing identity" } }, { song: null, version: 100 }), false);
});

test("status reconciliation handles playlist clear and attachment identity", () => {
  const status = { ...canonical, kind: "status", playlist: { id: "pl_1", name: "Set" } };
  assert.equal(postMatchesEditIntent(status, { review: canonical.review, playlistId: "pl_1", version: 10 }), true);
  assert.equal(postMatchesEditIntent(status, { playlistId: null, version: 10 }), false);
  assert.equal(postMatchesEditIntent({ ...status, playlist: null }, { playlistId: null, version: 10 }), true);
});

test("only ambiguous edit failures trigger a canonical read", () => {
  assert.equal(shouldReconcileEditFailure({ status: 0 }), true);
  assert.equal(shouldReconcileEditFailure({ status: 409 }), true);
  assert.equal(shouldReconcileEditFailure({ status: 503 }), true);
  assert.equal(shouldReconcileEditFailure({ status: 400 }), false);
  assert.equal(shouldReconcileEditFailure({ status: 403 }), false);
  assert.equal(shouldReconcileEditFailure({ status: 404 }), false);
});
