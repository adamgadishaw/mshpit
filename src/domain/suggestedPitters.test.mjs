import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { suggestedPittersIntro, visibleSuggestedPitters } from "./suggestedPitters.mjs";

const rows = (...ids) => ids.map((id) => ({
  user: { id, name: "Person " + id, handle: "person" + id },
  reason: "A fan to follow",
}));

test("mobile suggestions stay bounded, unique, and remove followed or blocked people", () => {
  const suggestions = [...rows("one", "two", "three", "four", "five", "six", "seven", "eight"), ...rows("one"), null];
  const original = suggestions.slice();
  const visible = visibleSuggestedPitters(
    suggestions,
    {
      isFollowing: (id) => id === "two",
      isBlocked: (id) => id === "four",
    },
  );
  assert.deepEqual(visible.map((row) => row.user.id), ["one", "three", "five", "six", "seven"]);
  assert.deepEqual(suggestions, original);
  assert.deepEqual(visibleSuggestedPitters(suggestions, { limit: 0 }), []);
});

test("mobile suggestion copy is location-aware without exposing distance", () => {
  assert.equal(suggestedPittersIntro("Toronto"), "Picked using location and music taste.");
  assert.equal(suggestedPittersIntro(""), "Picked using music taste and activity.");
  assert.doesNotMatch(suggestedPittersIntro("Toronto"), /\bkm\b|kilomet|mile|latitude|longitude/i);
});

test("the compact feed uses a horizontal suggestion rail without a nested virtualized list", async () => {
  const [app, feed, rail] = await Promise.all([
    readFile(new URL("../../App.js", import.meta.url), "utf8"),
    readFile(new URL("../screens/FeedScreen.jsx", import.meta.url), "utf8"),
    readFile(new URL("../components/SuggestedPittersRail.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(app, /suggestedUsers=\{discoverySidebar\?\.suggestedUsers \|\| \[\]\}/);
  assert.match(app, /showSuggestedPitters=\{!!session && !showRightRail\}/);
  assert.match(feed, /loggedIn && showSuggestedPitters/);
  assert.match(feed, /<SuggestedPittersRail/);
  assert.match(rail, /<ScrollView[\s\S]*\bhorizontal\b/);
  assert.doesNotMatch(rail, /FlatList|VirtualizedList/);
  assert.match(rail, /visibleSuggestedPitters\(suggestions, \{ isFollowing, isBlocked \}\)/);
  assert.match(rail, /onFollow\?\.\(person\.id\)/);
  assert.match(rail, /onOpenProfile\?\.\(person\.id\)/);
  assert.match(rail, /minHeight: 44/);
  assert.doesNotMatch(rail, /distanceKm|home\.lat|home\.lng/);
});
