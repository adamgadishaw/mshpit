import assert from "node:assert/strict";
import test from "node:test";

import {
  ARTIST_PAGE_SECTIONS,
  artistPagePreview,
  artistPageSectionModel,
  normalizeArtistPageSection,
} from "./artistPageSections.mjs";

test("artist page sections keep live shows primary and the release catalog explicit", () => {
  assert.deepEqual(ARTIST_PAGE_SECTIONS.map(({ key }) => key), ["overview", "live", "community", "music"]);
  assert.equal(normalizeArtistPageSection("MUSIC"), "music");
  assert.equal(normalizeArtistPageSection("unknown"), "overview");

  const overview = artistPageSectionModel("overview");
  assert.equal(overview.showLive, true);
  assert.equal(overview.showCommunity, true);
  assert.equal(overview.showMusic, false);
  assert.equal(overview.loadFullArchive, false);
  assert.equal(overview.loadDiscography, false);

  const music = artistPageSectionModel("music");
  assert.equal(music.showLive, false);
  assert.equal(music.showCommunity, false);
  assert.equal(music.showMusic, true);
  assert.equal(music.loadDiscography, true);
});

test("artist overview previews are bounded without mutating complete section rows", () => {
  const rows = [1, 2, 3, 4, 5];
  assert.deepEqual(artistPagePreview(rows, { condensed: true, limit: 2 }), [1, 2]);
  assert.strictEqual(artistPagePreview(rows), rows);
  assert.deepEqual(artistPagePreview(null, { condensed: true }), []);
});
