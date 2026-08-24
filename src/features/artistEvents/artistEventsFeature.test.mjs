import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveLoadState } from "../../domain/loadState.mjs";
import {
  artistEventArchiveScope,
  artistEventReviewsScope,
  EMPTY_ARTIST_EVENT_ARCHIVE,
  EMPTY_ARTIST_EVENT_REVIEWS,
  mergeArtistEventReviewPage,
  projectArtistEventArchive,
  projectArtistEventReviews,
} from "./artistEventState.mjs";

test("artist archive state clears synchronously across account and artist boundaries", () => {
  const accountA = { accountId: "account-a", artistKey: "alpha", name: "Alpha" };
  const ready = resolveLoadState({
    scope: artistEventArchiveScope(accountA),
    data: { ...EMPTY_ARTIST_EVENT_ARCHIVE, shows: [{ key: "private-projection" }] },
    updatedAt: 100,
  });
  for (const options of [
    { ...accountA, accountId: "account-b" },
    { ...accountA, accountId: null },
    { accountId: "account-a", artistKey: "beta", name: "Beta" },
  ]) {
    const projected = projectArtistEventArchive(ready, options);
    assert.equal(projected.status, "loading");
    assert.deepEqual(projected.data, EMPTY_ARTIST_EVENT_ARCHIVE);
    assert.equal(projected.updatedAt, null);
  }
});

test("review pagination deduplicates immutable post ids and selection scopes cannot collide", () => {
  const merged = mergeArtistEventReviewPage([{ id: "one", review: "old" }, { id: "two" }], [{ id: "one", review: "fresh" }, { id: "three" }]);
  assert.deepEqual(merged.map((review) => review.id), ["one", "two", "three"]);
  assert.equal(merged[0].review, "fresh");
  const showScope = artistEventReviewsScope({ accountId: "a", artistKey: "alpha", showKey: "same" });
  const tourScope = artistEventReviewsScope({ accountId: "a", artistKey: "alpha", tourKey: "same" });
  assert.notEqual(showScope, tourScope);

  const ready = resolveLoadState({ scope: showScope, data: { ...EMPTY_ARTIST_EVENT_REVIEWS, reviews: [{ id: "one" }] } });
  assert.deepEqual(projectArtistEventReviews(ready, { accountId: "b", artistKey: "alpha", showKey: "same" }).data, EMPTY_ARTIST_EVENT_REVIEWS);
});

test("feature source owns transport, cancellation, late-response fencing, and virtualized screens", () => {
  const hook = readFileSync(new URL("./useArtistEventArchive.js", import.meta.url), "utf8");
  const service = readFileSync(new URL("./services/artistEventApi.mjs", import.meta.url), "utf8");
  const archiveScreen = readFileSync(new URL("../../screens/ArtistArchiveScreen.jsx", import.meta.url), "utf8");
  const tourScreen = readFileSync(new URL("../../screens/TourArchiveScreen.jsx", import.meta.url), "utf8");

  for (const helper of ["createLoadState", "beginLoadState", "resolveLoadState", "rejectLoadState", "isLoadCancellation"]) {
    assert.match(hook, new RegExp(`\\b${helper}\\b`));
  }
  assert.match(hook, /new AbortController\(\)/);
  assert.match(hook, /controller\.abort\(\)/);
  assert.match(hook, /requestSequence\.current !== sequence|activeRequest\.current\?\.ticket !== ticket/);
  assert.match(service, /await api\(request\.path/);
  assert.match(service, /expectedAccountId: request\.expectedAccountId/);
  assert.match(service, /signal: options\.signal/);
  assert.doesNotMatch(hook, /from ["']\.\.\/\.\.\/store/);
  for (const source of [archiveScreen, tourScreen]) {
    assert.match(source, /<FlatList/);
    assert.match(source, /contentInsetAdjustmentBehavior="automatic"/);
    assert.doesNotMatch(source, /\bfetch\s*\(/);
  }
  assert.match(tourScreen, /onEndReached=/);
  assert.match(tourScreen, /const initialArchiveLoading = archiveResource\.status === "loading" && archiveResource\.updatedAt == null/);
  assert.match(tourScreen, /initialArchiveLoading \? \(/);
  assert.match(tourScreen, /Opening the tour archive…/);
});
