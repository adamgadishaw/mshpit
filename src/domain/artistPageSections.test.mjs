import assert from "node:assert/strict";
import test from "node:test";

import {
  ARTIST_OVERVIEW_LIMITS,
  ARTIST_PAGE_SECTIONS,
  artistPageHighlights,
  artistPagePreview,
  artistPageSectionModel,
  artistPageSynopsis,
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
  assert.deepEqual(ARTIST_OVERVIEW_LIMITS, {
    posts: 1,
    upcoming: 3,
    reviews: 1,
    gallery: 3,
    synopsisCharacters: 220,
  });
});

test("artist overview synopsis is compact and full copy remains available on demand", () => {
  assert.deepEqual(artistPageSynopsis("  A short artist story.  ", { condensed: true }), {
    text: "A short artist story.",
    truncated: false,
  });

  const long = "Artist story ".repeat(30);
  const compact = artistPageSynopsis(long, { condensed: true, limit: 40 });
  assert.equal([...compact.text].length <= 40, true);
  assert.equal(compact.text.endsWith("…"), true);
  assert.equal(compact.truncated, true);

  assert.deepEqual(artistPageSynopsis(long), {
    text: long.trim(),
    truncated: false,
  });
});

test("artist highlights stay factual, compact, and suppress future dates in memorial mode", () => {
  assert.deepEqual(artistPageHighlights({
    upcomingCount: 4,
    hometown: "  Fayetteville, North Carolina ",
    country: "United States",
    formed: "2007",
  }), [
    { key: "upcoming", label: "Upcoming", value: "4 shows", icon: "calendar" },
    { key: "from", label: "From", value: "Fayetteville, North Carolina", icon: "pin" },
    { key: "started", label: "Started", value: "2007", icon: "clock" },
  ]);
  assert.deepEqual(artistPageHighlights({ upcomingCount: 1, country: "Canada", formed: "unknown", memorialMode: true }), [
    { key: "from", label: "From", value: "Canada", icon: "pin" },
  ]);
  assert.deepEqual(artistPageHighlights(), []);
});
