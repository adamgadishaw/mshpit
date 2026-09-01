import assert from "node:assert/strict";
import test from "node:test";

import {
  ARTIST_DEATH_WATCH_FILTERS,
  artistDeathWatchEmptyMessage,
  artistDeathWatchProviderWarning,
  normalizeArtistDeathWatchFilter,
  shouldPollArtistDeathWatch,
} from "../../domain/artistDeathWatchPresentation.mjs";

test("death-watch filters are explicit and invalid input fails closed to pending review", () => {
  assert.deepEqual(ARTIST_DEATH_WATCH_FILTERS.map(({ status }) => status), [
    "pending", "dismissed", "memorialized",
  ]);
  assert.equal(normalizeArtistDeathWatchFilter(" DISMISSED "), "dismissed");
  assert.equal(normalizeArtistDeathWatchFilter("all"), "pending");
  assert.match(artistDeathWatchEmptyMessage("pending"), /need review/u);
  assert.match(artistDeathWatchEmptyMessage("memorialized"), /marked memorialized/u);
});

test("only a settled running snapshot schedules another status read", () => {
  assert.equal(shouldPollArtistDeathWatch({ running: true, resourceStatus: "ready" }), true);
  assert.equal(shouldPollArtistDeathWatch({ running: true, resourceStatus: "error" }), false);
  assert.equal(shouldPollArtistDeathWatch({ running: true, resourceStatus: "loading" }), false);
  assert.equal(shouldPollArtistDeathWatch({ running: true, resourceStatus: "refreshing" }), false);
  assert.equal(shouldPollArtistDeathWatch({ running: false, resourceStatus: "ready" }), false);
});

test("stored provider failures become plain-language staff warnings", () => {
  assert.match(artistDeathWatchProviderWarning("wikidata_timeout"), /source was slow/u);
  assert.match(artistDeathWatchProviderWarning("wikidata_timeout"), /Catalog progress and confirmed alerts were kept/u);
  assert.match(artistDeathWatchProviderWarning("musicbrainz_rate_limited"), /slow down/u);
  assert.match(artistDeathWatchProviderWarning("wikidata_unavailable"), /unavailable/u);
  assert.equal(artistDeathWatchProviderWarning(null), "");
});
