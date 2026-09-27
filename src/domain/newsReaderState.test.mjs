import assert from "node:assert/strict";
import test from "node:test";
import { newsAwareFeed, newsPrivacyScope, newsStateForScope, newsFeedSurfaceVisible } from "./newsReaderState.mjs";
import { readFileSync } from "node:fs";

const story = { id: "news_one", news: { headline: "One", artists: [{ name: "Moon Walker" }] } }, normal = { id: "p_one" };
test("a mounted feed is not an introduction visit during deep-link hydration, overlays or non-feed destinations", () => {
  const feed = { tab: "feed", web: true, pathname: "/feed", hasOverlay: false, landing: false, obscured: false, pendingNavigation: false };
  assert.equal(newsFeedSurfaceVisible(feed), true);
  assert.equal(newsFeedSurfaceVisible({ ...feed, web: false, pathname: null }), true);
  for (const change of [{ pathname: "/post/news_one" }, { pathname: "/artist/russ" }, { pathname: "/" }, { tab: "discover" }, { hasOverlay: true }, { landing: true }, { obscured: true }, { pendingNavigation: true }]) assert.equal(newsFeedSurfaceVisible({ ...feed, ...change }), false);
  const app = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
  const screen = readFileSync(new URL("../screens/FeedScreen.jsx", import.meta.url), "utf8");
  assert.match(app, /<FeedScreen\s+visible=\{feedSurfaceVisible\}/);
  assert.match(screen, /useNewsIntroduction\(visible && filter === "everyone" && loggedIn && appActive\)/);
});
test("news never leaks into Following, Local or guest feeds, including raw post fallback", () => {
  for (const filter of ["following", "local"]) assert.deepEqual(newsAwareFeed([story, normal, { id: "news_legacy" }], { filter, accountId: "a", introduction: story }), [normal]);
  assert.deepEqual(newsAwareFeed([story, normal], { filter: "everyone", accountId: null, introduction: story }), [normal]);
});
test("only introduction changes order; dedupe suppresses ordinary-feed duplicate and restart restores normal ranking", () => {
  assert.deepEqual(newsAwareFeed([normal, story], { filter: "everyone", accountId: "a", followedArtists: ["Moon Walker"], introduction: story }), [story, normal]);
  assert.deepEqual(newsAwareFeed([normal, story], { filter: "everyone", accountId: "a", followedArtists: ["Moon Walker"] }), [normal, story]);
});
test("unfollow removes cached/pinned news immediately; partial names do not imply follows", () => {
  for (const followedArtists of [[], ["Moon"], ["Moon Walker Two"], ["Russ"]]) assert.deepEqual(newsAwareFeed([normal, story], { filter: "everyone", accountId: "a", followedArtists, introduction: story }), [normal]);
});
test("account, blocks, withdrawn posts and artist follows synchronously hide old reader content", () => {
  const a = { session: { id: "a", favoriteArtists: ["Moon Walker"] }, blockedIds: [] };
  const scope = newsPrivacyScope(a), ready = { scope, stories: [story], nextCursor: "private-cursor", status: "ready" };
  for (const b of [{ ...a, session: { id: "b" } }, { ...a, session: null }, { ...a, blockedIds: ["author"] }, { ...a, removedIds: [story.id] }, { ...a, session: { id: "a", favoriteArtists: [] } }]) {
    const shown = newsStateForScope(ready, newsPrivacyScope(b));
    assert.deepEqual(shown.stories, []); assert.equal(shown.nextCursor, null);
  }
  assert.equal(newsStateForScope(ready, scope), ready);
  assert.deepEqual(newsStateForScope(ready, scope, false).stories, []);
});
