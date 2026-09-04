import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import { publicArtistPhoto } from "../../artistPhotoCatalog.js";
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

function registeredLicensedArtwork() {
  const photo = publicArtistPhoto("bryson tiller");
  assert.ok(photo?.creditPath);
  return {
    url: photo.uri,
    source: "licensed-media",
    title: photo.title,
    creator: photo.creator,
    license: photo.license,
    licenseUrl: photo.licenseUrl,
    sourcePage: photo.sourcePage,
    modificationNotice: photo.modificationNotice,
    creditPath: photo.creditPath,
    focalPoint: photo.focalPoint,
  };
}

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
  const licensedCandidate = registeredLicensedArtwork();
  const licensedGoing = eventShareCardModel(eventDocumentWithImage, "going", {
    fallbackArtwork: [licensedCandidate],
  });
  const review = reviewShareCardModel(reviewDocument({
    media: [{
      kind: "video",
      url: "https://media.mshpit.test/public/review.mp4",
      posterUrl: "https://media.mshpit.test/public/review-poster.jpg",
    }],
  }));

  assert.deepEqual(going.artwork, [], "provider hosting alone is not export permission");
  assert.deepEqual(licensedGoing.artwork, [licensedCandidate]);
  assert.deepEqual(review.artwork, [{
    url: "https://media.mshpit.test/public/review-poster.jpg",
    source: "owned-media",
  }]);
  assert.match(socialShareCardSvg(going), /data-layout="attendance-ticket"/u);
  assert.match(socialShareCardSvg(interested), /data-layout="attendance-ticket"/u);
  assert.match(socialShareCardSvg(review), /data-layout="review-photo"/u);
  assert.notEqual(socialShareCardSvg(going), socialShareCardSvg(interested));
  assert.doesNotMatch(socialShareCardSvg(review), /FAN REVIEW/u);
  const photoSvg = socialShareCardSvg(licensedGoing, {
    artworkDataUri: "data:image/jpeg;base64,/9j/2Q==",
    artwork: licensedGoing.artwork[0],
  });
  assert.match(photoSvg, /preserveAspectRatio="xMidYMin slice"/u);
  assert.doesNotMatch(photoSvg, /licensed-photo-credit/u);
  assert.doesNotMatch(photoSvg, /Bryson Tiller August|AtlantaFX|commons\.wikimedia\.org|creativecommons\.org|converted to WebP/u);
  assert.doesNotMatch(
    socialShareCardSvg(licensedGoing, {
      artworkDataUri: "data:image/jpeg;base64,/9j/2Q==",
    }),
    /AtlantaFX/u,
    "attribution must describe the candidate that was actually accepted",
  );
});

test("attendance artwork honors an explicit focal point while its default and review artwork stay centered", () => {
  const artworkDataUri = "data:image/jpeg;base64,/9j/2Q==";
  const attendanceSvg = socialShareCardSvg(
    eventShareCardModel(eventDocument(), "going"),
    { artworkDataUri },
  );
  const focalAttendanceSvg = socialShareCardSvg(
    eventShareCardModel(eventDocument(), "going"),
    {
      artworkDataUri,
      artwork: {
        url: "https://media.mshpit.test/public/share-tests/portrait.jpg",
        source: "owned-media",
        focalPoint: { x: 0.43, y: 0.2 },
      },
    },
  );
  const reviewSvg = socialShareCardSvg(
    reviewShareCardModel(reviewDocument()),
    { artworkDataUri },
  );

  assert.match(
    attendanceSvg,
    /<image[^>]+preserveAspectRatio="xMidYMid slice"[^>]+clip-path="url\(#attendanceHero\)"/u,
  );
  assert.match(
    focalAttendanceSvg,
    /<image[^>]+preserveAspectRatio="xMidYMin slice"[^>]+clip-path="url\(#attendanceHero\)"/u,
  );
  assert.match(
    reviewSvg,
    /<image[^>]+preserveAspectRatio="xMidYMid slice"[^>]+clip-path="url\(#reviewHero\)"/u,
  );
  assert.doesNotMatch(reviewSvg, /preserveAspectRatio="xMidYMin slice"/u);
});

test("portrait preparation preserves the pixels needed by explicit focal alignment", async () => {
  const blueLowerSection = await sharp({
    create: {
      width: 400,
      height: 640,
      channels: 3,
      background: { r: 15, g: 35, b: 230 },
    },
  }).png().toBuffer();
  const portrait = await sharp({
    create: {
      width: 400,
      height: 800,
      channels: 3,
      background: { r: 235, g: 25, b: 20 },
    },
  }).composite([{
    input: blueLowerSection,
    left: 0,
    top: 160,
  }]).jpeg({ quality: 95 }).toBuffer();

  const attendance = await renderSocialShareCardPng(
    eventShareCardModel(eventDocument(), "going"),
    {
      artworkBytes: portrait,
      artwork: {
        url: "https://media.mshpit.test/public/share-tests/portrait.jpg",
        source: "owned-media",
        focalPoint: { x: 0.43, y: 0.2 },
      },
    },
  );
  const review = await renderSocialShareCardPng(
    reviewShareCardModel(reviewDocument()),
    { artworkBytes: portrait },
  );
  const sample = (bytes, top) => sharp(bytes)
    .extract({ left: 520, top, width: 1, height: 1 })
    .removeAlpha()
    .raw()
    .toBuffer();
  const attendancePixel = await sample(attendance, 400);
  const reviewPixel = await sample(review, 500);

  assert.ok(attendancePixel[0] > attendancePixel[2] + 80,
    "the attendance hero keeps the portrait's top region");
  assert.ok(reviewPixel[2] > reviewPixel[0] + 80,
    "the review hero keeps its existing centered crop");
});

test("attendance cards keep one ticket geometry and place the RSVP disclaimer in bottom fine print", () => {
  const model = eventShareCardModel(eventDocument(), "going");
  const withoutPhoto = socialShareCardSvg(model);
  const withPhoto = socialShareCardSvg(model, {
    artworkDataUri: "data:image/jpeg;base64,/9j/2Q==",
  });
  const geometry = (svg) => ({
    hero: /data-section="attendance-hero-copy" data-kicker-y="(\d+)" data-artist-y="(\d+)"[\s\S]*?data-subtitle-y="(\d+)"/u.exec(svg)?.slice(1),
    meta: /data-section="attendance-meta"/u.test(svg),
  });

  assert.deepEqual(geometry(withoutPhoto), geometry(withPhoto));
  for (const svg of [withoutPhoto, withPhoto]) {
    assert.match(svg, /<rect x="40" y="328" width="1000" height="632" fill="#121018"\/>/u);
    assert.match(svg, /<rect x="40" y="960" width="1000" height="390" fill="#1d1434"\/>/u);
    assert.match(svg, /<rect x="40" y="1350" width="1000" height="330" fill="#251940"\/>/u);
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

test("photo attendance layout keeps worst-case authored text inside the hero and metadata regions", async () => {
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
  const hero = /data-section="attendance-hero-copy" data-kicker-y="(\d+)" data-artist-y="(\d+)" data-artist-lines="(\d+)" data-subtitle-y="(\d+)" data-subtitle-lines="(\d+)"/u.exec(svg);
  assert.ok(hero);
  const [, kickerY, artistY, artistLineCount, subtitleY, subtitleLineCount] = hero.map(Number);
  assert.ok(kickerY < artistY);
  assert.ok(artistY + ((artistLineCount - 1) * 80) < subtitleY);
  assert.ok(subtitleY + ((subtitleLineCount - 1) * 38) < 960);
  assert.match(svg, /clip-path="url\(#attendanceHeroCopy\)"/u);
  assert.match(svg, /clip-path="url\(#attendancePlace\)"/u);
  assert.match(svg, /clip-path="url\(#attendanceStatement\)"/u);
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

test("licensed attendance artwork stores its credit in PNG metadata without visible credit pixels", async () => {
  const photo = publicArtistPhoto("bryson tiller");
  const artwork = {
    url: photo.uri,
    source: "licensed-media",
    title: photo.title,
    creator: photo.creator,
    license: photo.license,
    licenseUrl: photo.licenseUrl,
    sourcePage: photo.sourcePage,
    modificationNotice: photo.modificationNotice,
    creditPath: photo.creditPath,
    focalPoint: photo.focalPoint,
  };
  const artworkBytes = await sharp({
    create: {
      width: 800,
      height: 1_000,
      channels: 3,
      background: { r: 50, g: 70, b: 100 },
    },
  }).jpeg().toBuffer();
  const bytes = await renderSocialShareCardPng(
    eventShareCardModel(eventDocument(), "going"),
    { artworkBytes, artwork },
  );
  const xmp = (await sharp(bytes).metadata()).xmp?.toString("utf8") || "";

  assert.match(xmp, /AtlantaFX/u);
  assert.match(xmp, new RegExp(`https://www\\.mshpit\\.com${photo.creditPath}`, "u"));
});

test("licensed artwork without an exact registered credit never reaches pixels or XMP", async () => {
  const artwork = {
    ...registeredLicensedArtwork(),
    creditPath: `/photo-credits/${"0".repeat(48)}`,
  };
  const artworkBytes = await sharp({
    create: {
      width: 800,
      height: 1_000,
      channels: 3,
      background: { r: 245, g: 15, b: 20 },
    },
  }).jpeg().toBuffer();
  const bytes = await renderSocialShareCardPng(
    eventShareCardModel(eventDocument(), "going"),
    { artworkBytes, artwork },
  );
  const metadata = await sharp(bytes).metadata();
  const sample = await sharp(bytes)
    .extract({ left: 500, top: 500, width: 1, height: 1 })
    .removeAlpha()
    .raw()
    .toBuffer();
  assert.ok(sample[0] < 100, "an unregistered licensed photo must use the dark no-photo hero");
  assert.equal(metadata.xmp, undefined);
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
  const licensedCandidate = registeredLicensedArtwork();
  const mediaBase = new URL(licensedCandidate.url).origin;
  const corruptUrl = `${mediaBase}/share-tests/corrupt.jpg`;
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
  let renderedArtwork = null;
  const renderer = createSocialShareCardRenderer({
    loadArtwork: (candidates, options) => loadShareArtwork(candidates, {
      ...options,
      env: { MEDIA_PUBLIC_BASE_URL: mediaBase },
      fetchImpl: async (url) => {
        requested.push(url);
        const body = url.includes("corrupt") ? corruptJpeg : validPhoto;
        return new Response(body, {
          headers: { "content-type": "image/jpeg", "content-length": String(body.length) },
        });
      },
    }),
    renderPng: async (_model, { artworkDataUri, artwork }) => {
      renderedArtworkDataUri = artworkDataUri;
      renderedArtwork = artwork;
      return {
        bytes: Buffer.concat([
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          Buffer.alloc(120, 4),
        ]),
        artworkApplied: !!artworkDataUri,
      };
    },
  });
  const model = eventShareCardModel(eventDocument(), "going", {
    fallbackArtwork: [
      { url: corruptUrl, source: "owned-media" },
      licensedCandidate,
    ],
  });

  const result = await renderer.render(model);
  assert.deepEqual(requested, [
    corruptUrl,
    licensedCandidate.url,
  ]);
  assert.match(renderedArtworkDataUri, /^data:image\/jpeg;base64,/u);
  assert.equal(renderedArtwork?.source, "licensed-media");
  assert.equal(renderedArtwork?.creator, licensedCandidate.creator);
  assert.equal(result.artwork?.creditPath, licensedCandidate.creditPath);
  assert.deepEqual(result.artwork?.focalPoint, { x: 0.43, y: 0.2 });
  assert.equal(result.bytes[8], 4);
  const cached = await renderer.render(model);
  assert.equal(cached.bytes, result.bytes);
  assert.deepEqual(cached.artwork, result.artwork);
  assert.equal(requested.length, 2, "cache hits retain artwork metadata without refetching");
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
  const model = reviewShareCardModel(reviewDocument());
  const sameA = renderer.render(model);
  const sameB = renderer.render(model);
  const other = reviewShareCardModel(reviewDocument({ id: "post_456" }));
  await assert.rejects(renderer.render(other), SocialShareCardBusyError);
  release();
  const [a, b] = await Promise.all([sameA, sameB]);
  assert.equal(calls, 1);
  assert.equal(a.bytes, b.bytes);
  const cached = await renderer.render(model);
  assert.equal(calls, 1);
  assert.equal(cached.bytes, a.bytes);
});

test("attendance artwork exhaustion fails closed instead of caching a no-photo final card", async () => {
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
  const model = eventShareCardModel(eventDocument(), "going", {
    fallbackArtwork: [{
      url: "https://media.mshpit.test/public/share-tests/show.jpg",
      source: "owned-media",
    }],
  });

  await assert.rejects(renderer.render(model), SocialShareCardArtworkUnavailableError);
  await assert.rejects(renderer.render(model), SocialShareCardArtworkUnavailableError);
  assert.equal(loads, 1);
  assert.equal(renders, 0);
  assert.equal(typeof loadOptions.acceptBytes, "function");
  assert.equal(loadOptions.signal instanceof AbortSignal, true,
    "shared work receives its own deadline signal instead of a caller request signal");
});

test("attendance cards without a trusted photo fail before rendering", async () => {
  let renders = 0;
  const renderer = createSocialShareCardRenderer({
    renderPng: async () => {
      renders += 1;
      throw new Error("an empty attendance card must never render");
    },
  });

  await assert.rejects(
    renderer.render(eventShareCardModel(eventDocument(), "going")),
    SocialShareCardArtworkUnavailableError,
  );
  assert.equal(renders, 0);
});

test("review artwork exhaustion can still render and cache the intentional no-photo design", async () => {
  let loads = 0;
  let renders = 0;
  const renderer = createSocialShareCardRenderer({
    loadArtwork: async () => {
      loads += 1;
      return null;
    },
    renderPng: async (_model, { artworkDataUri }) => {
      renders += 1;
      assert.equal(artworkDataUri, "");
      return {
        bytes: Buffer.concat([
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          Buffer.alloc(120, 7),
        ]),
        artworkApplied: false,
      };
    },
  });
  const document = reviewDocument();
  document.image = "https://media.mshpit.test/public/reviews/missing.jpg";
  const model = reviewShareCardModel(document);

  const first = await renderer.render(model);
  const second = await renderer.render(model);
  assert.equal(loads, 1);
  assert.equal(renders, 1);
  assert.equal(first.bytes, second.bytes);
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
  const model = eventShareCardModel(eventDocument(), "going", {
    fallbackArtwork: [{
      url: "https://media.mshpit.test/public/share-tests/show.jpg",
      source: "owned-media",
    }],
  });

  await assert.rejects(renderer.render(model), SocialShareCardArtworkUnavailableError);
  await assert.rejects(renderer.render(model), SocialShareCardArtworkUnavailableError);
  assert.equal(loads, 1, "the short error cache prevents repeated provider hammering");
  assert.equal(renders, 0);

  clock += 2_001;
  await assert.rejects(renderer.render(model), SocialShareCardArtworkUnavailableError);
  assert.equal(loads, 2, "the card can be retried after the short error window");
  assert.equal(socialShareCardConstants.transientFailureCacheTtlMs, 5_000);
});

test("one total deadline bounds sequential artwork resolution and rendering", async () => {
  let requests = 0;
  const renderer = createSocialShareCardRenderer({
    totalWorkTimeoutMs: 500,
    loadArtwork: (candidates, options) => loadShareArtwork(candidates, {
      ...options,
      env: { MEDIA_PUBLIC_BASE_URL: "https://media.mshpit.test/public" },
      fetchImpl: async (_url, { signal }) => {
        requests += 1;
        return new Promise((resolve, reject) => {
          const onAbort = () => reject(signal.reason || new DOMException("Aborted", "AbortError"));
          if (signal.aborted) onAbort();
          else signal.addEventListener("abort", onAbort, { once: true });
        });
      },
    }),
  });
  const candidates = ["one", "two", "three"].map((name) => ({
    url: `https://media.mshpit.test/public/share-tests/${name}.jpg`,
    source: "owned-media",
  }));
  const startedAt = Date.now();

  await assert.rejects(
    renderer.render(eventShareCardModel(eventDocument(), "going", { fallbackArtwork: candidates })),
    SocialShareCardArtworkUnavailableError,
  );
  assert.ok(Date.now() - startedAt < 1_200, "three candidates share one bounded deadline");
  assert.equal(requests, 1, "the total deadline stops resolution before later candidates begin");
  assert.equal(socialShareCardConstants.totalWorkTimeoutMs, 4_000);
});

test("the same total deadline turns a stalled render into a retryable artwork failure", async () => {
  let renderSignal = null;
  const renderer = createSocialShareCardRenderer({
    totalWorkTimeoutMs: 500,
    renderPng: async (_model, { signal }) => {
      renderSignal = signal;
      return new Promise((resolve, reject) => {
        const onAbort = () => reject(signal.reason || new DOMException("Aborted", "AbortError"));
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      });
    },
  });
  const startedAt = Date.now();

  await assert.rejects(
    renderer.render(reviewShareCardModel(reviewDocument())),
    SocialShareCardArtworkUnavailableError,
  );
  assert.equal(renderSignal instanceof AbortSignal, true);
  assert.ok(Date.now() - startedAt < 1_200, "native render shares the same total deadline");
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
  const artworkDocument = reviewDocument();
  artworkDocument.image = "https://media.mshpit.test/public/reviews/show.jpg";
  const waitingForArtwork = renderer.render(reviewShareCardModel(artworkDocument));
  await artworkStarted;

  const noArtworkModel = reviewShareCardModel(reviewDocument({ id: "post_456" }));
  const noArtwork = await renderer.render(noArtworkModel);
  assert.equal(noArtwork.bytes[8], 6);
  releaseArtwork();
  const completedArtworkFallback = await waitingForArtwork;
  assert.equal(completedArtworkFallback.bytes[8], 5);
  assert.deepEqual(renderOrder, [
    "https://www.mshpit.com/post/post_456",
    "https://www.mshpit.com/post/post_123",
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
  const model = reviewShareCardModel(reviewDocument());
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
