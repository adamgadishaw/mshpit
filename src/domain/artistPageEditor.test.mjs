import assert from "node:assert/strict";
import test from "node:test";
import {
  beginLoadState,
  createLoadState,
  rejectLoadState,
  resolveLoadState,
} from "./loadState.mjs";
import { artistPageEditReady } from "./artistPageEditor.mjs";

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
