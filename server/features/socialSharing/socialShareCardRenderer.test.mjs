import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import {
  createSocialShareCardRenderer,
  eventShareCardModel,
  renderSocialShareCardPng,
  reviewShareCardModel,
  socialShareCardConstants,
  socialShareCardSvg,
  SocialShareCardBusyError,
} from "./socialShareCardRenderer.js";

function eventDocument(overrides = {}) {
  return {
    kind: "event",
    event: {
      id: "ticketmaster-event_123",
      name: "The Last Encore Tour",
      artist: "The Example",
      venue: "Massey Hall",
      place: "Toronto, Ontario, Canada",
      date: "2026-10-16",
      localTime: "19:30:00",
      ...overrides,
    },
  };
}

function reviewDocument(overrides = {}) {
  return {
    kind: "post",
    post: {
      id: "post_123",
      kind: "review",
      artist: "The Example",
      venue: "Massey Hall",
      city: "Toronto",
      showDate: "2026-10-16",
      rating: 4.7,
      text: "A sharp, generous performance with a huge closing song.",
      tour: "The Last Encore Tour",
      media: [],
      author: { name: "Alex" },
      ...overrides,
    },
  };
}

test("event and review models accept only public projection fields and canonical Mshpit URLs", () => {
  const event = eventShareCardModel(eventDocument({
    seat: "PRIVATE-SECTION",
    orderNumber: "PRIVATE-ORDER",
    barcode: "PRIVATE-BARCODE",
    ticketUrl: "https://tickets.example/private",
  }), "going");
  const review = reviewShareCardModel(reviewDocument({
    text: "Loved it. https://tracker.example/member-secret",
    email: "private@example.com",
    viewerAttendance: { visibility: "private" },
  }));

  assert.equal(event.canonicalUrl, "https://www.mshpit.com/event/ticketmaster-event_123");
  assert.equal(review.canonicalUrl, "https://www.mshpit.com/post/post_123");
  assert.equal(
    eventShareCardModel(eventDocument(), "interested", { authorName: "Alex" }).kicker,
    "Alex IS INTERESTED",
  );
  const serialized = JSON.stringify({ event, review });
  for (const secret of [
    "PRIVATE-SECTION", "PRIVATE-ORDER", "PRIVATE-BARCODE",
    "tickets.example", "tracker.example", "private@example.com", "visibility",
  ]) assert.doesNotMatch(serialized, new RegExp(secret, "iu"));
});

test("share models never normalize impossible calendar dates into a different day", () => {
  assert.equal(
    eventShareCardModel(eventDocument({ date: "2026-02-31" }), "going"),
    null,
  );
  assert.equal(
    reviewShareCardModel(reviewDocument({ showDate: "2026-02-31" })).date,
    "DATE TO BE ANNOUNCED",
  );
});

test("SVG artwork bounds pathological words, escapes authored text, and uses one MSHPIT brand", () => {
  const malicious = `<script>&"'${"A".repeat(160)}`;
  const model = reviewShareCardModel(reviewDocument({
    artist: malicious,
    text: "Strong night <script>alert(1)</script> & worth seeing.",
  }));
  const svg = socialShareCardSvg(model);

  assert.doesNotMatch(svg, /<script>/iu);
  assert.match(svg, /&lt;script&gt;&amp;&quot;&apos;/u);
  assert.doesNotMatch(svg, new RegExp("A".repeat(160)));
  assert.match(svg, /…/u);
  assert.match(svg, />MSHPIT</u);
  assert.doesNotMatch(svg, /MSH PIT/u);
  assert.match(svg, /OPEN THE REVIEW ON MSHPIT/u);
  assert.doesNotMatch(svg, /OPEN THE SHOW ON MSHPIT/u);

  const eventSvg = socialShareCardSvg(eventShareCardModel(eventDocument(), "going"));
  assert.match(eventSvg, /OPEN THE SHOW ON MSHPIT/u);
  assert.doesNotMatch(eventSvg, /OPEN THE REVIEW ON MSHPIT/u);
});

test("renderer emits a bounded 1080 by 1920 Instagram Story PNG", async () => {
  const model = eventShareCardModel(eventDocument(), "interested");
  const bytes = await renderSocialShareCardPng(model);
  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(bytes.length < socialShareCardConstants.maxBytes);
  const metadata = await sharp(bytes).metadata();
  assert.equal(metadata.width, socialShareCardConstants.width);
  assert.equal(metadata.height, socialShareCardConstants.height);
  assert.equal(metadata.width, 1080);
  assert.equal(metadata.height, 1920);
  assert.equal(metadata.format, "png");
});

test("renderer coalesces and caches equal cards while bounding unique concurrent work", async () => {
  let calls = 0;
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const renderer = createSocialShareCardRenderer({
    maxConcurrentRenders: 1,
    renderPng: async () => {
      calls += 1;
      await waiting;
      return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.alloc(120, 1),
      ]);
    },
  });
  const model = eventShareCardModel(eventDocument(), "going");
  const sameA = renderer.render(model);
  const sameB = renderer.render(model);
  const other = eventShareCardModel(eventDocument({ id: "ticketmaster-event_456" }), "going");
  await assert.rejects(renderer.render(other), SocialShareCardBusyError);
  release();
  const [a, b] = await Promise.all([sameA, sameB]);
  assert.equal(calls, 1);
  assert.equal(a.bytes, b.bytes);
  const cached = await renderer.render(model);
  assert.equal(calls, 1);
  assert.equal(cached.bytes, a.bytes);
});
