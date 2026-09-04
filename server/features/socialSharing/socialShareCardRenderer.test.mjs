import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import {
  loadShareArtwork,
  ShareArtworkTransientError,
} from "./socialShareArtwork.js";

import {
  createSocialShareCardRenderer,
  eventShareCardModel,
  renderSocialShareCardPng,
  reviewShareCardModel,
  socialShareCardConstants,
  socialShareCardSvg,
  SocialShareCardArtworkUnavailableError,
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
  assert.equal(review.label, "REVIEW");
  assert.equal(review.kicker, "Alex");
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

test("share models preserve only projected artwork provenance and keep each share type visually distinct", () => {
  const eventDocumentWithImage = eventDocument({
    providerImage: { url: "https://s1.ticketm.net/dam/a/show.jpg" },
  });
  eventDocumentWithImage.image = "https://s1.ticketm.net/dam/a/show.jpg";
  const going = eventShareCardModel(eventDocumentWithImage, "going");
  const interested = eventShareCardModel(eventDocumentWithImage, "interested");
  const review = reviewShareCardModel(reviewDocument({
    media: [{
      kind: "video",
      url: "https://media.mshpit.test/public/review.mp4",
      posterUrl: "https://media.mshpit.test/public/review-poster.jpg",
    }],
  }));

  assert.deepEqual(going.artwork, [{
    url: "https://s1.ticketm.net/dam/a/show.jpg",
    source: "ticketmaster",
  }]);
  assert.deepEqual(review.artwork, [{
    url: "https://media.mshpit.test/public/review-poster.jpg",
    source: "owned-media",
  }]);
  assert.match(socialShareCardSvg(going), /data-layout="attendance-ticket"/u);
  assert.match(socialShareCardSvg(interested), /data-layout="attendance-ticket"/u);
  assert.match(socialShareCardSvg(review), /data-layout="review-photo"/u);
  assert.notEqual(socialShareCardSvg(going), socialShareCardSvg(interested));
  assert.doesNotMatch(socialShareCardSvg(review), /FAN REVIEW/u);
});

test("attendance cards keep one ticket geometry and place the RSVP disclaimer in bottom fine print", () => {
  const model = eventShareCardModel(eventDocument(), "going");
  const withoutPhoto = socialShareCardSvg(model);
  const withPhoto = socialShareCardSvg(model, {
    artworkDataUri: "data:image/jpeg;base64,/9j/2Q==",
  });
  const geometry = (svg) => ({
    body: /data-section="attendance-body" data-statement-y="(\d+)"[\s\S]*?data-artist-y="(\d+)"/u.exec(svg)?.slice(1),
    schedule: /data-section="attendance-schedule" data-schedule-y="(\d+)"/u.exec(svg)?.[1],
  });

  assert.deepEqual(geometry(withoutPhoto), geometry(withPhoto));
  for (const svg of [withoutPhoto, withPhoto]) {
    assert.match(svg, /<rect x="40" y="328" width="1000" height="392" fill="#121018"\/>/u);
    assert.match(svg, />MSHPIT<\/text>/u);
    assert.match(svg, />LIVE MUSIC, REMEMBERED<\/text>/u);
    assert.match(svg, />MSHPIT RSVP<\/text>/u);
    assert.match(svg, />RSVP<\/text>/u);
    assert.doesNotMatch(svg, /SOCIAL RSVP|MSHPIT \/ GOING/u);
    assert.ok(svg.indexOf("NOT VALID FOR ENTRY") > svg.indexOf("OPEN THE SHOW ON MSHPIT"));
  }
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

test("photo attendance layout keeps worst-case authored text above the ticket perforation", async () => {
  const model = eventShareCardModel(eventDocument({
    name: "The Extremely Long Farewell Celebration and Final Stadium Experience",
    artist: "WWWWWWWWWWWWWWWWWWWW WWWWWWWWWWWWWWWWWWWW",
    venue: "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW",
    place: "A Very Long Metropolitan Region, Ontario, Canada",
  }), "going", {
    authorName: "A Member With An Intentionally Long Display Name",
  });
  const svg = socialShareCardSvg(model, {
    artworkDataUri: "data:image/jpeg;base64,/9j/2Q==",
  });
  const body = /data-section="attendance-body" data-statement-y="(\d+)" data-subtitle-y="(\d+)" data-subtitle-lines="(\d+)" data-artist-y="(\d+)" data-artist-lines="(\d+)"/u.exec(svg);
  const schedule = /data-section="attendance-schedule" data-schedule-y="(\d+)"/u.exec(svg);
  assert.ok(body);
  assert.ok(schedule);
  const [, statementY, subtitleY, subtitleLineCount, artistY, artistLineCount] = body.map(Number);
  const scheduleY = Number(schedule[1]);
  assert.ok(Number(statementY) < Number(subtitleY));
  assert.ok(Number(artistY) > Number(subtitleY) + ((subtitleLineCount - 1) * 32) + 26);
  assert.ok(scheduleY > Number(artistY) + ((artistLineCount - 1) * 68) + 18);
  assert.ok(scheduleY + 158 < 1350);
  assert.match(svg, /clip-path="url\(#attendanceBody\)"/u);
  assert.match(svg, /clip-path="url\(#attendanceVenue\)"/u);
  assert.match(svg, /…/u);
  const photo = await sharp({
    create: {
      width: 1_200,
      height: 800,
      channels: 3,
      background: { r: 60, g: 80, b: 120 },
    },
  }).jpeg().toBuffer();
  const output = await renderSocialShareCardPng(model, { artworkBytes: photo });
  const metadata = await sharp(output).metadata();
  assert.deepEqual([metadata.width, metadata.height], [1080, 1920]);
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

test("renderer composites a real photo and degrades invalid image bytes to the clean no-photo card", async () => {
  const model = reviewShareCardModel(reviewDocument());
  const photo = await sharp({
    create: {
      width: 1_200,
      height: 800,
      channels: 3,
      background: { r: 240, g: 20, b: 30 },
    },
  }).jpeg().toBuffer();
  const withPhoto = await renderSocialShareCardPng(model, { artworkBytes: photo });
  const sample = await sharp(withPhoto)
    .extract({ left: 500, top: 500, width: 1, height: 1 })
    .removeAlpha()
    .raw()
    .toBuffer();
  assert.ok(sample[0] > sample[1] + 100, "the projected photo should occupy the review hero");

  const withoutPhoto = await renderSocialShareCardPng(model, {
    artworkBytes: Buffer.from("not an image"),
  });
  const metadata = await sharp(withoutPhoto).metadata();
  assert.equal(metadata.width, 1080);
  assert.equal(metadata.height, 1920);
});

test("renderer rejects unsupported decoded formats and artwork above the pixel ceiling", async () => {
  const model = reviewShareCardModel(reviewDocument());
  const oversized = await sharp({
    create: {
      width: 4_001,
      height: 3_000,
      channels: 3,
      background: { r: 240, g: 20, b: 30 },
    },
  }).jpeg({ quality: 20 }).toBuffer();
  const unsupported = await sharp({
    create: {
      width: 320,
      height: 240,
      channels: 3,
      background: { r: 240, g: 20, b: 30 },
    },
  }).gif().toBuffer();
  assert.ok(oversized.length < socialShareCardConstants.artworkInputBytes);
  assert.ok(4_001 * 3_000 > socialShareCardConstants.artworkInputPixels);

  for (const artworkBytes of [oversized, unsupported]) {
    const output = await renderSocialShareCardPng(model, { artworkBytes });
    const sample = await sharp(output)
      .extract({ left: 500, top: 500, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer();
    assert.ok(sample[0] < 100, "rejected artwork must use the dark no-photo hero");
  }
});

test("renderer skips a MIME-valid corrupt image and uses the next trusted candidate", async () => {
  const validPhoto = await sharp({
    create: {
      width: 640,
      height: 480,
      channels: 3,
      background: { r: 30, g: 180, b: 90 },
    },
  }).jpeg().toBuffer();
  const corruptJpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
    0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0xff, 0xd9,
  ]);
  const requested = [];
  let renderedArtworkDataUri = "";
  const renderer = createSocialShareCardRenderer({
    loadArtwork: (candidates, options) => loadShareArtwork(candidates, {
      ...options,
      fetchImpl: async (url) => {
        requested.push(url);
        const body = url.includes("corrupt") ? corruptJpeg : validPhoto;
        return new Response(body, {
          headers: { "content-type": "image/jpeg", "content-length": String(body.length) },
        });
      },
    }),
    renderPng: async (_model, { artworkDataUri }) => {
      renderedArtworkDataUri = artworkDataUri;
      return {
        bytes: Buffer.concat([
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          Buffer.alloc(120, 4),
        ]),
        artworkApplied: !!artworkDataUri,
      };
    },
  });
  const document = eventDocument({
    providerImage: { url: "https://s1.ticketm.net/dam/a/corrupt.jpg" },
  });
  const model = eventShareCardModel(document, "going", {
    fallbackArtwork: [{
      url: "https://s1.ticketm.net/dam/a/valid.jpg",
      source: "ticketmaster",
    }],
  });

  const result = await renderer.render(model);
  assert.deepEqual(requested, [
    "https://s1.ticketm.net/dam/a/corrupt.jpg",
    "https://s1.ticketm.net/dam/a/valid.jpg",
  ]);
  assert.match(renderedArtworkDataUri, /^data:image\/jpeg;base64,/u);
  assert.equal(result.bytes[8], 4);
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

test("permanent artwork exhaustion renders and caches one stable no-photo card", async () => {
  let loads = 0;
  let renders = 0;
  let loadOptions = "not-called";
  const renderer = createSocialShareCardRenderer({
    loadArtwork: async (_candidates, options) => {
      loads += 1;
      loadOptions = options;
      return null;
    },
    renderPng: async (_model, { artworkDataUri }) => {
      renders += 1;
      return {
        bytes: Buffer.concat([
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          Buffer.alloc(120, 1),
        ]),
        artworkApplied: !!artworkDataUri,
      };
    },
  });
  const document = eventDocument({
    providerImage: { url: "https://s1.ticketm.net/dam/a/show.jpg" },
  });
  document.image = "https://s1.ticketm.net/dam/a/show.jpg";
  const model = eventShareCardModel(document, "going");

  const first = await renderer.render(model);
  const second = await renderer.render(model);
  assert.equal(loads, 1);
  assert.equal(renders, 1);
  assert.equal(first.bytes, second.bytes);
  assert.equal(typeof loadOptions.acceptBytes, "function");
  assert.equal(loadOptions.signal, undefined, "shared work must not inherit a caller request signal");
});

test("temporary artwork exhaustion uses a short error-only cache before allowing retry", async () => {
  let loads = 0;
  let renders = 0;
  let clock = 10_000;
  const renderer = createSocialShareCardRenderer({
    transientFailureCacheTtlMs: 2_000,
    now: () => clock,
    loadArtwork: async () => {
      loads += 1;
      throw new ShareArtworkTransientError();
    },
    renderPng: async () => {
      renders += 1;
      throw new Error("temporary artwork must not render a replacement card");
    },
  });
  const document = eventDocument({
    providerImage: { url: "https://s1.ticketm.net/dam/a/show.jpg" },
  });
  const model = eventShareCardModel(document, "going");

  await assert.rejects(renderer.render(model), SocialShareCardArtworkUnavailableError);
  await assert.rejects(renderer.render(model), SocialShareCardArtworkUnavailableError);
  assert.equal(loads, 1, "the short error cache prevents repeated provider hammering");
  assert.equal(renders, 0);

  clock += 2_001;
  await assert.rejects(renderer.render(model), SocialShareCardArtworkUnavailableError);
  assert.equal(loads, 2, "the card can be retried after the short error window");
  assert.equal(socialShareCardConstants.transientFailureCacheTtlMs, 5_000);
});

test("remote artwork waiting does not occupy the Sharp render admission slot", async () => {
  let markArtworkStarted;
  let releaseArtwork;
  const artworkStarted = new Promise((resolve) => { markArtworkStarted = resolve; });
  const artworkWaiting = new Promise((resolve) => { releaseArtwork = resolve; });
  const renderOrder = [];
  const renderer = createSocialShareCardRenderer({
    maxConcurrentRenders: 1,
    loadArtwork: async () => {
      markArtworkStarted();
      await artworkWaiting;
      return null;
    },
    renderPng: async (model) => {
      renderOrder.push(model.canonicalUrl);
      return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.alloc(120, model.canonicalUrl.endsWith("456") ? 6 : 5),
      ]);
    },
  });
  const artworkDocument = eventDocument({
    providerImage: { url: "https://s1.ticketm.net/dam/a/show.jpg" },
  });
  const waitingForArtwork = renderer.render(eventShareCardModel(artworkDocument, "going"));
  await artworkStarted;

  const noArtworkModel = eventShareCardModel(eventDocument({ id: "ticketmaster-event_456" }), "going");
  const noArtwork = await renderer.render(noArtworkModel);
  assert.equal(noArtwork.bytes[8], 6);
  releaseArtwork();
  const completedArtworkFallback = await waitingForArtwork;
  assert.equal(completedArtworkFallback.bytes[8], 5);
  assert.deepEqual(renderOrder, [
    "https://www.mshpit.com/event/ticketmaster-event_456",
    "https://www.mshpit.com/event/ticketmaster-event_123",
  ]);
});

test("the first caller aborting does not cancel a coalesced renderer request", async () => {
  let markStarted;
  let release;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const waiting = new Promise((resolve) => { release = resolve; });
  const renderer = createSocialShareCardRenderer({
    renderPng: async () => {
      markStarted();
      await waiting;
      return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.alloc(120, 3),
      ]);
    },
  });
  const model = eventShareCardModel(eventDocument(), "going");
  const controller = new AbortController();
  const first = renderer.render(model, { signal: controller.signal });
  await started;
  const second = renderer.render(model);
  controller.abort(new DOMException("first caller left", "AbortError"));
  await assert.rejects(first, (error) => error?.name === "AbortError");
  release();
  const completed = await second;
  assert.equal(completed.bytes[8], 3);
});
