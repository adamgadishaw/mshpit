import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { feedDiscoveryPlacement, feedPostPosition, IOS_FEED_DISCOVERY_SLOT } from "./feedDiscoveryPlacement.mjs";
import { nextVisibleMediaPostIds } from "./posterVisibility.mjs";
const posts = Array.from({ length: 8 }, (_, index) => ({ id: `p_${index}`, review: `Post ${index}` }));

test("iOS shows three original posts before a standalone discovery row", () => {
  const result = feedDiscoveryPlacement(posts, { platform: "ios", enabled: true });
  assert.equal(result.placement, "inline"); assert.equal(result.index, 3);
  assert.deepEqual(result.rows.slice(0, 3), posts.slice(0, 3));
  assert.equal(result.rows[3], IOS_FEED_DISCOVERY_SLOT);
  assert.deepEqual(result.rows.filter(row => row !== IOS_FEED_DISCOVERY_SLOT), posts);
  assert.equal(posts.length, 8); assert.equal(result.rows.length, 9);
  result.rows.filter(row => row !== IOS_FEED_DISCOVERY_SLOT).forEach((row, index) => assert.equal(row, posts[index]));
});

test("iOS preserves empty-feed discovery but does not promote people inside the news desk", () => {
  const empty = [];
  assert.equal(feedDiscoveryPlacement(empty, { platform: "ios", enabled: true }).placement, "header");
  assert.equal(feedDiscoveryPlacement(posts, { platform: "ios", enabled: true, newsTab: true }).placement, "hidden");
  assert.equal(feedDiscoveryPlacement(posts, { platform: "ios", enabled: false }).rows, posts);
  const short = feedDiscoveryPlacement(posts.slice(0, 1), { platform: "ios", enabled: true });
  assert.equal(short.index, 1); assert.equal(short.rows[0], posts[0]); assert.equal(short.rows[1], IOS_FEED_DISCOVERY_SLOT);
});

test("Android and web retain exact row array identity and header placement", () => {
  for (const platform of ["android", "web"]) for (const newsTab of [true, false]) for (const enabled of [true, false]) {
    const result = feedDiscoveryPlacement(posts, { platform, enabled, newsTab });
    assert.equal(result.rows, posts); assert.equal(result.index, -1);
    assert.equal(result.placement, enabled ? "header" : "hidden");
  }
});

test("discovery never qualifies as media or a post impression, and post positions remain original", () => {
  assert.equal(IOS_FEED_DISCOVERY_SLOT.id, undefined); assert.equal(IOS_FEED_DISCOVERY_SLOT.postId, undefined);
  assert.ok(Object.isFrozen(IOS_FEED_DISCOVERY_SLOT));
  assert.deepEqual([...nextVisibleMediaPostIds(new Set(), [{ item: IOS_FEED_DISCOVERY_SLOT, isViewable: true }])], []);
  const result = feedDiscoveryPlacement(posts, { platform: "ios", enabled: true });
  result.rows.forEach((item, index) => {
    if (item !== IOS_FEED_DISCOVERY_SLOT) assert.equal(feedPostPosition(index, result.index), posts.indexOf(item));
  });
  assert.equal(feedPostPosition(undefined, 3), 0); assert.equal(feedPostPosition(4, -1), 4);
  const source = readFileSync(new URL("../screens/FeedScreen.jsx", import.meta.url), "utf8");
  assert.match(source, /if \(!item\?\.id\) continue/);
  assert.match(source, /feedPostPosition\(token\.index, analyticsRef\.current\.discoveryIndex\)/);
  assert.match(source, /itemIndex=\{feedPostPosition\(itemIndex, discovery\.index\)\}/);
  assert.match(source, /item === IOS_FEED_DISCOVERY_SLOT \? suggestions/);
});
