import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const artistScreen = readFileSync(new URL("../screens/ArtistScreen.jsx", import.meta.url), "utf8");
const storeSource = readFileSync(new URL("../store.js", import.meta.url), "utf8");

test("artist pages show only the verified public genre and explain missing evidence", () => {
  assert.match(artistScreen, /const genre = a\.genre \|\| "Genre not listed yet"/);
  assert.match(artistScreen, /<Text style=\{styles\.genreTxt\}>\{genre\}<\/Text>/);
  assert.doesNotMatch(artistScreen, /cap\(meta\?\.genre\)|genreHint|const genre = [^\n]*"-"/);
  assert.match(storeSource, /return buildArtistSummary\(\{/);
  assert.doesNotMatch(storeSource, /genre:\s*nights\.find\([^\n]+\|\|\s*cat\?\.genre\s*\|\|\s*"-"/);
});

test("artist pull-to-refresh invalidates DB metadata without provider resolution", () => {
  assert.match(artistScreen, /refreshArtistCatalogMetadata\(a\.name, \{ signal \}\)/);
  assert.match(storeSource, /refreshArtistCatalogEntry\(name, \{ signal, apiClient: api \}\)/);
});
