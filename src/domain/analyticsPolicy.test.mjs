import assert from "node:assert/strict";
import test from "node:test";
import { analyticsDurationBucket, analyticsDwellBucket, sanitizeAnalyticsEvent } from "./analyticsPolicy.mjs";

test("analytics policy keeps categorical fields and rejects authored or sensitive text", () => {
  assert.deepEqual(sanitizeAnalyticsEvent({
    id: "evt_12345678",
    name: "feed_impression",
    props: {
      postId: "p_12345678",
      position: 4,
      surface: "everyone",
      algorithm: "global-personal-v1",
      algorithmVersion: 1,
      reasonCode: "local",
      review: "a private review",
      message: "secret DM",
      mediaUrl: "https://cdn.example/private.mov",
    },
  }, { requireId: true }), {
    id: "evt_12345678",
    name: "feed_impression",
    props: { postId: "p_12345678", position: 4, surface: "everyone", algorithm: "global-personal-v1", algorithmVersion: 1, reasonCode: "local" },
  });

  assert.deepEqual(sanitizeAnalyticsEvent({ name: "search", props: { q: "person@example.com", kind: "all", resultBucket: "one_to_five" } }), {
    name: "search",
    props: { kind: "all", resultBucket: "one_to_five" },
  });
  assert.deepEqual(sanitizeAnalyticsEvent({ name: "play", props: { artist: "Private Artist", title: "Private Song" } }), { name: "play", props: {} });
});

test("analytics policy rejects unknown names and malformed idempotency identifiers", () => {
  assert.equal(sanitizeAnalyticsEvent({ id: "bad id", name: "screen_view", props: { screen: "tab_feed" } }, { requireId: true }), null);
  assert.equal(sanitizeAnalyticsEvent({ id: "evt_12345678", name: "arbitrary", props: {} }, { requireId: true }), null);
  assert.equal(sanitizeAnalyticsEvent({ id: "evt_12345678", name: "screen_view", props: { screen: "mysecretsearch" } }, { requireId: true }), null);
  assert.equal(sanitizeAnalyticsEvent({ id: "evt_12345678", name: "product_error", props: { code: "mysecretsearch", surface: "screen", retryable: true } }, { requireId: true }), null);
  assert.deepEqual(sanitizeAnalyticsEvent({ id: "evt_12345678", name: "screen_view", props: { screen: "tab_feed", referrer: "Free text is rejected" } }, { requireId: true }), {
    id: "evt_12345678",
    name: "screen_view",
    props: { screen: "tab_feed" },
  });
});

test("artist workspace and fan preview screen views survive the shared analytics allowlist", () => {
  assert.deepEqual(sanitizeAnalyticsEvent({ name: "screen_view", props: { screen: "artist_hq", referrer: "artist" } }), {
    name: "screen_view",
    props: { screen: "artist_hq", referrer: "artist" },
  });
  assert.deepEqual(sanitizeAnalyticsEvent({ name: "screen_view", props: { screen: "artist_preview", referrer: "artist_hq" } }), {
    name: "screen_view",
    props: { screen: "artist_preview", referrer: "artist_hq" },
  });
  for (const screen of ["artist_archive", "artist_tour"]) {
    assert.deepEqual(sanitizeAnalyticsEvent({ name: "screen_view", props: { screen, referrer: "artist" } }), {
      name: "screen_view",
      props: { screen, referrer: "artist" },
    });
  }
  for (const name of ["view_artist_archive", "view_artist_tour", "view_performance"]) {
    assert.deepEqual(sanitizeAnalyticsEvent({ name, props: { artist: "Authored names never leave the device" } }), { name, props: {} });
  }
});

test("analytics latency buckets are stable at their boundaries", () => {
  assert.equal(analyticsDurationBucket(249), "under_250ms");
  assert.equal(analyticsDurationBucket(250), "250_to_750ms");
  assert.equal(analyticsDurationBucket(5000), "over_5s");
  assert.equal(analyticsDwellBucket(2999), "under_3s");
  assert.equal(analyticsDwellBucket(30_000), "30_to_90s");
});
