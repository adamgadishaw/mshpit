import test from "node:test";
import assert from "node:assert/strict";

import { buildReviewCreateBody, buildReviewEditBody } from "./post-payload.mjs";

test("a selected J. Cole catalog key survives the review create payload", () => {
  const body = buildReviewCreateBody({
    id: "post_jcole_retry_001",
    artist: "J. Cole",
    artistKey: "j. cole",
    venue: "Scotiabank Arena",
    city: "Toronto",
    date: "2026-07-27",
    overall: 5,
    band: 5,
    room: 4.5,
    dims: { performance: 5 },
    review: "Toronto night one",
    photos: [],
    mediaAssetIds: ["ma_abcdefgh12345678", "ma_abcdefgh12345678", "forged"],
    photosPublic: true,
    landingShowcase: true,
    setlist: [],
    tags: ["final tour"],
    taggedPeople: [{ id: "u_friend", name: "Mara" }, { id: "u_friend", name: "Duplicate" }],
  });

  assert.equal(body.artist, "J. Cole");
  assert.equal(body.clientMutationId, "post_jcole_retry_001");
  assert.equal(body.artistKey, "j. cole");
  assert.equal(body.venue, "Scotiabank Arena");
  assert.equal(body.date, "2026-07-27");
  assert.equal(body.landingShowcase, 1);
  assert.deepEqual(body.mediaAssetIds, ["ma_abcdefgh12345678"]);
  assert.deepEqual(body.tags, []);
  assert.deepEqual(body.taggedUserIds, ["u_friend"]);
});

test("descriptive tags stay retired while concert companion tags remain", () => {
  const body = buildReviewEditBody({
    artist: "J. Cole",
    venue: "Scotiabank Arena",
    overall: 5,
    tags: ["hip-hop", "high energy"],
    taggedPeople: [{ id: "u_friend", name: "Mara" }],
  });

  assert.deepEqual(body.tags, []);
  assert.deepEqual(body.taggedUserIds, ["u_friend"]);
});

test("review payloads never feature photos that are not public", () => {
  assert.equal(buildReviewCreateBody({ id: "post_private_001", photosPublic: false, landingShowcase: true }).landingShowcase, 0);
  assert.equal(buildReviewEditBody({ photosPublic: false, landingShowcase: true }).landingShowcase, false);
});

test("an explicit empty stable-media selection clears post media on edit", () => {
  const body = buildReviewEditBody({ photos: [], mediaAssetIds: [], photosPublic: true });
  assert.deepEqual(body.mediaAssetIds, []);
});

test("review edits sanitize and explicitly send the selected artist key", () => {
  const body = buildReviewEditBody({
    artist: "  J. Cole  ",
    artistKey: `  j. cole\u0000${"x".repeat(140)}  `,
    venue: "  Scotiabank Arena  ",
    city: " Toronto ",
    date: "2026-07-27",
    overall: 5,
  });

  assert.equal(body.artist, "J. Cole");
  assert.equal(body.artistKey.startsWith("j. colex"), true);
  assert.equal(body.artistKey.length, 120);
  assert.equal(body.venue, "Scotiabank Arena");
  assert.equal(body.city, "Toronto");
  assert.equal(Object.prototype.hasOwnProperty.call(body, "artistKey"), true);
  assert.equal(buildReviewEditBody({ artist: "Local act", artistKey: null }).artistKey, null);
});

test("online review payloads keep the YouTube source and clear physical-show identity", () => {
  const body = buildReviewCreateBody({
    id: "post_online_001",
    experienceType: "online",
    artist: "Beyonce",
    artistKey: "beyonce",
    venue: "Should be removed",
    city: "Toronto",
    date: "2026-09-01",
    tour: "A physical tour",
    overall: 4.5,
    band: 5,
    room: 4,
    dims: { performance: 5 },
    onlineTitle: "  Homecoming  ",
    youtubeUrl: "https://youtu.be/dQw4w9WgXcQ?t=30",
    photos: [],
    taggedPeople: [],
    photosPublic: true,
    landingShowcase: true,
    setlist: ["Song"],
    tags: ["High energy"],
    song: { videoId: "dQw4w9WgXcQ" },
  });
  assert.equal(body.experienceType, "online");
  assert.equal(body.onlineTitle, "Homecoming");
  assert.equal(body.youtubeUrl, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.deepEqual({ venue: body.venue, city: body.city, date: body.date, tour: body.tour }, {
    venue: "", city: "", date: "", tour: null,
  });
  assert.deepEqual(body.dims, {});
  assert.deepEqual(body.setlist, []);
  assert.deepEqual(body.tags, []);
  assert.equal(body.landingShowcase, 0);
  assert.equal(body.song, null);
});

test("online review edits also clear physical quick tags", () => {
  const body = buildReviewEditBody({
    experienceType: "online",
    artist: "Beyonce",
    overall: 4.5,
    youtubeUrl: "https://youtu.be/dQw4w9WgXcQ",
    tags: ["Crowd interaction"],
  });
  assert.deepEqual(body.tags, []);
});

test("editing back to an in-person review explicitly clears online-only fields", () => {
  const body = buildReviewEditBody({
    experienceType: "in_person",
    artist: "Beyonce",
    venue: "Rogers Centre",
    overall: 5,
    onlineTitle: "Hidden",
    youtubeUrl: "https://youtu.be/dQw4w9WgXcQ",
  });
  assert.equal(body.experienceType, "in_person");
  assert.equal(body.onlineTitle, null);
  assert.equal(body.youtubeUrl, null);
  assert.equal(body.venue, "Rogers Centre");
});
