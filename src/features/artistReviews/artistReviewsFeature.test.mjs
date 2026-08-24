import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { beginLoadState, createLoadState, rejectLoadState, resolveLoadState } from "../../domain/loadState.mjs";
import {
  artistReviewsFromResponse,
  artistReviewsRequest,
} from "./artistReviewsRequest.mjs";
import {
  artistReviewsScope,
  EMPTY_ARTIST_REVIEWS,
  projectArtistReviewsResource,
  selectArtistReviewsPresentation,
} from "./artistReviewsState.mjs";

function appError() {
  const error = new Error("Try again");
  error.name = "AppError";
  error.code = "PIT-NET-001";
  error.retryable = true;
  return error;
}

test("artist review requests encode identity, bound the read, and bind every account scope", () => {
  assert.deepEqual(
    artistReviewsRequest({ artistKey: "  artist/key  ", name: "A & B", limit: 99, accountId: "account-a" }),
    {
      path: "/api/artists/reviews?artistKey=artist%2Fkey&name=A%20%26%20B&limit=10",
      expectedAccountId: "account-a",
    },
  );
  assert.equal(artistReviewsRequest({ name: "Alpha", limit: 0, accountId: "account-b" }).path.endsWith("limit=3"), true);
  assert.equal(artistReviewsRequest({ name: "Alpha", accountId: "account-b" }).expectedAccountId, "account-b");
  assert.equal(artistReviewsRequest({ name: "Alpha", accountId: null }).expectedAccountId, null);
  assert.throws(() => artistReviewsRequest({}), /require an artist identity/);
});

test("artist review responses distinguish a valid empty result from transport shape failure", () => {
  const reviews = [{ id: "review-1" }];
  assert.equal(artistReviewsFromResponse({ reviews }), reviews);
  assert.deepEqual(artistReviewsFromResponse({ reviews: [] }), []);
  assert.throws(() => artistReviewsFromResponse({}), /response is invalid/);
  assert.throws(() => artistReviewsFromResponse({ reviews: null }), /response is invalid/);
});

test("artist review state clears data and errors across account A to B to guest", () => {
  const target = { name: "Alpha", artistKey: "alpha" };
  const accountAScope = artistReviewsScope({ ...target, accountId: "account-a" });
  const accountAReady = resolveLoadState({
    scope: accountAScope,
    data: [{ id: "account-a-private-projection" }],
    updatedAt: 100,
  });
  const accountAError = rejectLoadState(accountAReady, {
    scope: accountAScope,
    error: appError(),
    emptyData: EMPTY_ARTIST_REVIEWS,
  });

  for (const accountId of ["account-b", null]) {
    const projected = projectArtistReviewsResource(accountAError, { ...target, accountId });
    assert.deepEqual(projected.data, []);
    assert.equal(projected.status, "loading");
    assert.equal(projected.error, null);
    assert.equal(projected.updatedAt, null);
    assert.equal(projected.scope, artistReviewsScope({ ...target, accountId }));
  }
});

test("presentation uses hydrated reviews only before the authoritative artist read resolves", () => {
  const scope = artistReviewsScope({ accountId: "account-a", artistKey: "alpha" });
  const hydrated = [{ id: "hydrated", kind: "review", review: "On this device", overall: 4 }];
  const authoritative = [{ id: "authoritative", kind: "review", review: "From every night", overall: 5 }];
  const loading = createLoadState({ scope, status: "loading", data: EMPTY_ARTIST_REVIEWS });

  assert.deepEqual(selectArtistReviewsPresentation(loading, hydrated), {
    reviews: hydrated,
    source: "hydrated",
    initialError: false,
    refreshError: false,
  });

  const ready = resolveLoadState({ scope, data: authoritative, updatedAt: 100 });
  assert.deepEqual(selectArtistReviewsPresentation(ready, hydrated), {
    reviews: authoritative,
    source: "authoritative",
    initialError: false,
    refreshError: false,
  });
  assert.deepEqual(
    selectArtistReviewsPresentation(resolveLoadState({ scope, data: [], updatedAt: 101 }), hydrated).reviews,
    [],
    "an authoritative empty result must not resurrect device-only reviews",
  );
});

test("presentation retains a same-scope snapshot and labels retryable initial fallback", () => {
  const scope = artistReviewsScope({ accountId: "account-a", artistKey: "alpha" });
  const hydrated = [{ id: "hydrated", kind: "review", review: "On this device", overall: 4 }];
  const authoritative = [{ id: "authoritative", kind: "review", review: "From every night", overall: 5 }];
  const ready = resolveLoadState({ scope, data: authoritative, updatedAt: 100 });
  const refreshing = beginLoadState(ready, { scope, emptyData: EMPTY_ARTIST_REVIEWS });
  assert.equal(refreshing.status, "refreshing");
  assert.deepEqual(selectArtistReviewsPresentation(refreshing, hydrated).reviews, authoritative);

  const initialFailure = rejectLoadState(null, {
    scope,
    error: appError(),
    emptyData: EMPTY_ARTIST_REVIEWS,
  });
  const initialFallback = selectArtistReviewsPresentation(initialFailure, hydrated);
  assert.equal(initialFallback.source, "hydrated");
  assert.equal(initialFallback.initialError, true);
  assert.deepEqual(initialFallback.reviews, hydrated);

  const refreshFailure = rejectLoadState(ready, {
    scope,
    error: appError(),
    emptyData: EMPTY_ARTIST_REVIEWS,
  });
  const retained = selectArtistReviewsPresentation(refreshFailure, hydrated);
  assert.equal(retained.source, "authoritative");
  assert.equal(retained.refreshError, true);
  assert.deepEqual(retained.reviews, authoritative);
});

test("hook and service retain the canonical load, cancellation, and API boundaries", () => {
  const hookSource = readFileSync(new URL("./useArtistTopReviews.js", import.meta.url), "utf8");
  const serviceSource = readFileSync(new URL("./services/artistReviewsApi.mjs", import.meta.url), "utf8");

  for (const helper of ["createLoadState", "beginLoadState", "resolveLoadState", "rejectLoadState", "isLoadCancellation"]) {
    assert.match(hookSource, new RegExp(`\\b${helper}\\b`));
  }
  assert.match(hookSource, /new AbortController\(\)/);
  assert.match(hookSource, /controller\.abort\(\)/);
  assert.match(serviceSource, /await api\(request\.path/);
  assert.match(serviceSource, /expectedAccountId: request\.expectedAccountId/);
  assert.match(serviceSource, /signal: options\.signal/);
  assert.doesNotMatch(serviceSource, /\{\s*ok:\s*false/);
});
