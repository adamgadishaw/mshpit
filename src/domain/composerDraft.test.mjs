import test from "node:test";
import assert from "node:assert/strict";

import {
  composerDraftFingerprint,
  composerDraftHasContent,
  composerDraftTitle,
  normalizeComposerDraft,
  shouldFlushComposerDraft,
  shouldScheduleComposerDraftPersistence,
} from "./composerDraft.mjs";

test("status drafts preserve playlist, unresolved song input, media, and panel state", () => {
  const draft = normalizeComposerDraft({
    id: "draft_1",
    postType: "status",
    review: "J. Cole was unreal",
    tagDraft: "toronto",
    songUrl: "https://youtu.be/example",
    playlist: { id: "playlist_1", name: "Concert night", tracks: [{ id: "track_1" }] },
    taggedPeople: [{ id: "u_friend", name: "Mara", handle: "mara" }],
    photos: ["https://media.example/one.jpg"],
    panels: { song: true, photos: true, playlist: true, people: true },
  });

  assert.equal(draft.postType, "status");
  assert.equal(draft.songUrl, "https://youtu.be/example");
  assert.equal(draft.playlist.id, "playlist_1");
  assert.deepEqual(draft.photos, ["https://media.example/one.jpg"]);
  assert.deepEqual(draft.taggedPeople.map((person) => person.id), ["u_friend"]);
  assert.deepEqual(draft.panels, { song: true, photos: true, playlist: true, people: true });
  assert.equal(composerDraftTitle(draft), "J. Cole was unreal");
});

test("show drafts preserve posting identity, entity binding, ratings, consent, and unfinished tags", () => {
  const draft = normalizeComposerDraft({
    submissionId: "post_retry_identity",
    postType: "show",
    artist: "J. Cole",
    artistKey: "j-cole",
    venue: "Scotiabank Arena",
    date: "2026-08-09",
    dims: { performance: 5, crowd: 4.5 },
    tagDraft: "no skips",
    photosPublic: false,
    landingShowcase: true,
  });

  assert.equal(draft.submissionId, "post_retry_identity");
  assert.equal(draft.artistKey, "j-cole");
  assert.equal(draft.dims.performance, 5);
  assert.equal(draft.dims.crowd, 4.5);
  assert.equal(draft.tagDraft, "no skips");
  assert.equal(draft.photosPublic, false);
  assert.equal(draft.landingShowcase, false);
  assert.equal(composerDraftHasContent(draft), true);
  assert.equal(composerDraftTitle(draft), "J. Cole \u00b7 Scotiabank Arena");
});

test("homepage showcase consent defaults off for legacy and new drafts", () => {
  assert.equal(normalizeComposerDraft({}).landingShowcase, false);
  assert.equal(normalizeComposerDraft({ photosPublic: true, landingShowcase: true }).landingShowcase, true);
});

test("draft fingerprints ignore storage metadata but include user-visible changes", () => {
  const base = { postType: "status", review: "hello", submissionId: "post_1" };
  assert.equal(
    composerDraftFingerprint({ ...base, id: "draft_1", ownerId: "u_1", at: 1 }),
    composerDraftFingerprint({ ...base, id: "draft_2", ownerId: "u_1", at: 2 }),
  );
  assert.notEqual(composerDraftFingerprint(base), composerDraftFingerprint({ ...base, review: "hello again" }));
});

test("default mode, date, and opened panels alone do not create empty drafts", () => {
  assert.equal(composerDraftHasContent({ postType: "status", date: "2026-08-13", panels: { photos: true } }), false);
});

test("selected friends survive drafts and participate in dirty fingerprints", () => {
  const taggedPeople = [{ id: "u_friend", name: "Mara", handle: "mara" }];
  assert.equal(composerDraftHasContent({ postType: "show", taggedPeople }), true);
  assert.notEqual(
    composerDraftFingerprint({ postType: "show", taggedPeople }),
    composerDraftFingerprint({ postType: "show", taggedPeople: [] }),
  );
});

test("featured post metadata survives status drafts without becoming fake post content", () => {
  const campaign = { version: 1, treatment: "after-dark", backgroundAssetId: "ma_abcdefgh12345678" };
  const draft = normalizeComposerDraft({ postType: "status", campaign, review: "New record at midnight." });
  assert.deepEqual(draft.campaign, campaign);
  assert.equal(composerDraftTitle(normalizeComposerDraft({ postType: "status", campaign })), "Featured post draft");
  assert.equal(composerDraftHasContent({ postType: "status", campaign }), false, "styling alone cannot publish an empty post");
  assert.equal(normalizeComposerDraft({ postType: "show", campaign }).campaign, null);
  assert.notEqual(
    composerDraftFingerprint({ postType: "status", review: "drop", campaign }),
    composerDraftFingerprint({ postType: "status", review: "drop", campaign: { ...campaign, treatment: "spotlight" } }),
  );
});

test("clearing a saved draft schedules deletion even when the form equals its pristine baseline", () => {
  assert.equal(shouldScheduleComposerDraftPersistence({ dirty: false, hasDraft: true, hasContent: false }), true);
  assert.equal(shouldScheduleComposerDraftPersistence({ dirty: true, hasDraft: true, hasContent: true, fingerprint: "same", savedFingerprint: "same" }), false);
  assert.equal(shouldScheduleComposerDraftPersistence({ editing: true, dirty: true, hasDraft: true }), false);
});

test("backgrounding flushes a saved draft even if no new keystroke is pending", () => {
  assert.equal(shouldFlushComposerDraft({ hasDraft: true }), true);
  assert.equal(shouldFlushComposerDraft({ dirty: true }), true);
  assert.equal(shouldFlushComposerDraft({ editing: true, dirty: true, hasDraft: true }), false);
});

test("durable Studio assets persist recipes and accessibility copy without device-local files", () => {
  const draft = normalizeComposerDraft({
    postType: "status",
    mediaProject: { assets: [{
      id: "studio:1",
      assetId: "ma_abcdefgh12345678",
      kind: "image",
      uri: "https://media.mshpit.com/users/u/post/render.webp",
      sourceUrl: "https://media.mshpit.com/users/u/post/render.webp",
      status: "ready",
      width: 1080,
      height: 1350,
      altText: "Crowd under amber lights",
      runtimeFile: { size: 99, secret: "not persistent" },
    }] },
  });
  assert.deepEqual(draft.photos, ["https://media.mshpit.com/users/u/post/render.webp"]);
  assert.equal(draft.mediaProject.assets[0].assetId, "ma_abcdefgh12345678");
  assert.equal(draft.mediaProject.assets[0].altText, "Crowd under amber lights");
  assert.equal(JSON.stringify(draft).includes("runtimeFile"), false);
  assert.equal(JSON.stringify(draft).includes("not persistent"), false);
});

test("native PIT-managed selections make a recoverable media-only draft", () => {
  const uri = "file:///data/user/0/com.mshpit.app/files/pit-studio/u_1/post_1/01-photo.jpg";
  const draft = normalizeComposerDraft({
    postType: "status",
    mediaProject: { assets: [{
      id: "local:photo",
      kind: "image",
      uri,
      durableLocalUri: uri,
      status: "editing",
      width: 1200,
      height: 900,
      altText: "Singer in amber light",
    }] },
  });
  assert.equal(composerDraftHasContent(draft), true);
  assert.equal(draft.photos.length, 0);
  assert.equal(draft.mediaProject.assets.length, 1);
  assert.equal(draft.mediaProject.assets[0].durableLocalUri, uri);
  assert.equal(draft.mediaProject.assets[0].altText, "Singer in amber light");
});
