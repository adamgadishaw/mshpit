import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  feedFilterStorageKey,
  feedFooterState,
  normalizeFeedFilter,
  recommendationDisclosure,
} from "./feedExperience.mjs";

test("feed selection is validated and scoped to an account", () => {
  assert.equal(feedFilterStorageKey("u_1"), "pit.feed.filter.v1.u_1");
  assert.equal(feedFilterStorageKey(null), "pit.feed.filter.v1.guest");
  assert.equal(normalizeFeedFilter("following", { loggedIn: true }), "following");
  assert.equal(normalizeFeedFilter("unknown", { loggedIn: true }), "everyone");
  assert.equal(normalizeFeedFilter("local", { loggedIn: false }), "everyone");
});

test("feed footer creates deliberate stopping points", () => {
  assert.deepEqual(feedFooterState({ visibleCount: 8, loadedCount: 16, hasMore: true }), { kind: "reveal", label: "Show more posts" });
  assert.deepEqual(feedFooterState({ visibleCount: 16, loadedCount: 16, hasMore: true }), { kind: "fetch", label: "Load older posts" });
  assert.deepEqual(feedFooterState({ visibleCount: 16, loadedCount: 16, hasMore: false }), { kind: "caught-up", label: "You're caught up" });
  assert.deepEqual(feedFooterState({ loading: true }), { kind: "loading", label: "Loading older posts..." });
});

test("post recommendation disclosures stay neutral while ranking signals remain internal", () => {
  assert.deepEqual(recommendationDisclosure(null), null);
  const disclosure = recommendationDisclosure({
    reasonCode: "local",
    reason: "Popular near you",
    personalized: true,
    algorithm: "global-personal-v1",
  });
  assert.equal(disclosure.label, "Suggested post");
  assert.equal(disclosure.detail, "Pit mixes recent posts from across the community to keep your feed fresh. Suggestions change over time.");
  assert.doesNotMatch(`${disclosure.label} ${disclosure.detail}`, /popular near you|saved home city|follow|genre|artist activity|likes|discussion/i);
  assert.equal(disclosure.personalized, true);
});

test("recommended status cards expose the same explanation and feedback as reviews", async () => {
  const source = await readFile(new URL("../components/TicketStub.jsx", import.meta.url), "utf8");
  const statusStart = source.indexOf('if (log.kind === "status")');
  const reviewStart = source.indexOf("\n  return (", statusStart);
  assert.ok(statusStart >= 0 && reviewStart > statusStart, "status render branch remains discoverable");
  const statusBranch = source.slice(statusStart, reviewStart);
  const reviewBranch = source.slice(reviewStart);
  assert.match(statusBranch, /<RecommendationWhy\b/);
  assert.match(statusBranch, /<NotForMeButton\b/);
  assert.match(statusBranch, /<ViewTally count=\{viewCount\}/);
  assert.match(reviewBranch, /<ViewTally count=\{viewCount\}/);
  assert.match(source, /"About this post"/);
  assert.doesNotMatch(source, /This recommendation uses your Pit preferences|This recommendation is community-based/);
  assert.match(source, /accessibilityLabel=\{`\$\{value\} member /);
  assert.doesNotMatch(source, /unique member/);
});
