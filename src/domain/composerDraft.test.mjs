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
    photos: ["https://media.example/one.jpg"],
    panels: { song: true, photos: true, playlist: true },
  });

  assert.equal(draft.postType, "status");
  assert.equal(draft.songUrl, "https://youtu.be/example");
  assert.equal(draft.playlist.id, "playlist_1");
  assert.deepEqual(draft.photos, ["https://media.example/one.jpg"]);
  assert.deepEqual(draft.panels, { song: true, photos: true, playlist: true });
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
  });

  assert.equal(draft.submissionId, "post_retry_identity");
  assert.equal(draft.artistKey, "j-cole");
  assert.equal(draft.dims.performance, 5);
  assert.equal(draft.dims.crowd, 4.5);
  assert.equal(draft.tagDraft, "no skips");
  assert.equal(draft.photosPublic, false);
  assert.equal(composerDraftHasContent(draft), true);
  assert.equal(composerDraftTitle(draft), "J. Cole \u00b7 Scotiabank Arena");
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
