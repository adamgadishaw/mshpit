import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [source, store] = await Promise.all([
  readFile(new URL("../screens/SearchScreen.jsx", import.meta.url), "utf8"),
  readFile(new URL("../store.js", import.meta.url), "utf8"),
]);

test("guest unified search never calls the member-only people endpoint", () => {
  assert.match(source, /people: session\?\.id \? searchPeople\(searchQuery, requestOptions\) : null/);
  assert.match(source, /canSearchPeople: Boolean\(session\?\.id\)/);
});

test("guest search measurement sends only coarse outcomes after search settles", () => {
  assert.match(source, /recordGuestSearch\(\{ kind: "all", resultBucket, outcome: "success" \}/);
  assert.match(source, /recordGuestSearch\(\{ kind: "all", resultBucket: "unknown", outcome: "failed" \}/);
  assert.doesNotMatch(source, /recordGuestSearch\(\{[^}]*\b(?:query|q|text|userId|ip|url)\b/s);
});

test("unified artist outages reach the failed guest-search counter", () => {
  assert.match(store, /const searchArtistsApi = async \(query, \{[\s\S]*?signal,[\s\S]*?throwOnError = false,[\s\S]*?\} = \{\}\)/);
  assert.match(store, /if \(throwOnError\) throw error;/);
  assert.match(source, /searchArtistsApi\(searchQuery, requestOptions\)/);
});
