import assert from "node:assert/strict";
import test from "node:test";
import {
  beginLoadState,
  createLoadState,
  rejectLoadState,
  resolveLoadState,
} from "./loadState.mjs";
import {
  artistPageEditReady,
  artistProfileEditorPatch,
  confirmedArtistProfileMutation,
} from "./artistPageEditor.mjs";

const scope = "artist-page-editor:turnstile";

test("artist page editing waits for a confirmed server profile", () => {
  const loading = createLoadState({ scope, status: "loading", data: null });
  assert.equal(artistPageEditReady(loading), false);

  const unconfirmedCache = createLoadState({
    scope,
    status: "loading",
    data: { profile: { bio: "stale" } },
  });
  assert.equal(artistPageEditReady(unconfirmedCache), false);

  const ready = resolveLoadState({
    scope,
    data: { profile: { bio: "confirmed", feedEnabled: true }, posts: [] },
    updatedAt: 100,
  });
  assert.equal(artistPageEditReady(ready), true);
});

test("a retained confirmed profile remains editable while its refresh is pending or fails", () => {
  const confirmed = resolveLoadState({
    scope,
    data: { profile: {}, posts: [] },
    updatedAt: 100,
  });
  const refreshing = beginLoadState(confirmed, { scope, emptyData: null, retainData: true });
  assert.equal(artistPageEditReady(refreshing), true);

  const error = Object.assign(new Error("offline"), {
    name: "AppError",
    code: "PIT-NET-001",
    retryable: true,
  });
  const stale = rejectLoadState(refreshing, { scope, error, emptyData: null, retainData: true });
  assert.equal(artistPageEditReady(stale), true);
});

test("malformed or absent profile snapshots never unlock editing", () => {
  for (const profile of [null, [], "profile"]) {
    const resource = resolveLoadState({ scope, data: { profile, posts: [] }, updatedAt: 100 });
    assert.equal(artistPageEditReady(resource), false);
  }
});

test("artist page save requires an authoritative profile matching the requested photo", () => {
  const avatarUri = "https://media.example/steve-lacy.jpg";
  const confirmed = confirmedArtistProfileMutation({
    ok: true,
    profile: {
      ownerId: null,
      bio: null,
      banner: null,
      avatarUri,
      feedEnabled: false,
    },
  }, { avatarUri });
  assert.equal(confirmed.avatarUri, avatarUri);
  assert.equal(confirmed.bio, null,
    "a photo-only update accepts an unchanged null biography");
  assert.equal(confirmed.ownerId, null, "staff can seed an unclaimed artist page");
});

test("photo drafts omit untouched biography fallbacks and feed settings on every retry", () => {
  for (const bio of ["", "Catalog Wikipedia excerpt", "Saved staff biography"]) {
    const draft = { bio, bioChanged: false, feedEnabled: false, initialFeedEnabled: false,
      avatarUri: "https://media.example/new.jpg", avatarChanged: true, bannerChanged: false };
    const expected = { avatarUri: draft.avatarUri };
    assert.deepEqual(artistProfileEditorPatch(draft), expected);
    assert.deepEqual(artistProfileEditorPatch(draft), expected);
    assert.equal(confirmedArtistProfileMutation({ ok: true, profile: {
      bio: "Changed concurrently", bioStaffCurated: true, feedEnabled: true,
      avatarUri: draft.avatarUri, banner: null,
    } }, expected).bioStaffCurated, true);
  }
});

test("intentional biography edits and clears remain explicit across failed readbacks", () => {
  for (const [bio, expected] of [[" New biography ", "New biography"], ["", ""], ["   ", ""]]) {
    const draft = { bio, bioChanged: true, feedEnabled: true, initialFeedEnabled: false };
    const patch = artistProfileEditorPatch(draft);
    assert.deepEqual(patch, { bio: expected, feedEnabled: true });
    assert.equal(confirmedArtistProfileMutation({ ok: true }, patch), null);
    assert.deepEqual(artistProfileEditorPatch(draft), patch);
    assert.equal(confirmedArtistProfileMutation({ ok: true, profile: {
      bio: expected || null, bioStaffCurated: true, feedEnabled: true, avatarUri: null, banner: null,
    } }, patch).bioStaffCurated, true);
  }
});

test("artist page save rejects bare success, malformed URLs, and mismatched artwork", () => {
  assert.equal(confirmedArtistProfileMutation({ ok: true }, {}), null);
  assert.equal(confirmedArtistProfileMutation({
    ok: true,
    profile: { ownerId: null, bio: "", banner: null, avatarUri: "file:///preview.jpg", feedEnabled: false },
  }, { avatarUri: "file:///preview.jpg" }), null);
  assert.equal(confirmedArtistProfileMutation({
    ok: true,
    profile: {
      ownerId: null,
      bio: "",
      banner: null,
      avatarUri: "https://media.example/old.jpg",
      feedEnabled: false,
    },
  }, { avatarUri: "https://media.example/new.jpg" }), null);
});
