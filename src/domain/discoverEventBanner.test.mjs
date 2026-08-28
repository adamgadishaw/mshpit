import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDiscoverEventBannerSlides,
  discoverEventIdentity,
  isDiscoverEventBannerMediaEligible,
} from "./discoverEventBanner.mjs";

const events = [
  { id: "cne-2026", eventName: "Canadian National Exhibition", eventKind: "fair", artist: "The Beaches", venue: "Exhibition Place", place: "Toronto, Ontario", date: "2026-08-21", eventEndDate: "2026-09-07" },
  { id: "show-2", artist: "IDLES", venue: "History", place: "Toronto, Ontario", date: "2026-09-18" },
];

test("event banner identities use stable IDs and only fall back to exact show tuples", () => {
  assert.equal(discoverEventIdentity(events[0]), "id:cne-2026");
  assert.equal(discoverEventIdentity({ artist: " IDLES ", venue: "History", date: "2026-09-18" }), "show:idles|history|2026-09-18");
  assert.equal(discoverEventIdentity({ artist: "IDLES", venue: "History" }), "");
});

test("banner media fails closed for private fan photos and unproven provider artwork", () => {
  assert.equal(isDiscoverEventBannerMediaEligible({ uri: "https://media.test/fan.jpg", source: "fan", photosPublic: true }), true);
  assert.equal(isDiscoverEventBannerMediaEligible({ uri: "https://media.test/private.jpg", source: "fan", photosPublic: false }), false);
  assert.equal(isDiscoverEventBannerMediaEligible({ uri: "https://media.test/provider.jpg", source: "organizer" }), false);
  assert.equal(isDiscoverEventBannerMediaEligible({ uri: "https://media.test/provider.jpg", source: "organizer", rightsApproved: true }), true);
  assert.equal(isDiscoverEventBannerMediaEligible({ uri: "https://media.test/clip.mp4", source: "fan", photosPublic: true }), false);
  assert.equal(isDiscoverEventBannerMediaEligible({ uri: "http://media.test/insecure.jpg", source: "fan", photosPublic: true }), false);
});

test("licensed banner media requires machine-verifiable attribution", () => {
  const complete = {
    uri: "https://media.test/commons.jpg",
    source: "commons",
    creator: "Concert Photographer",
    license: "CC-BY-4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    sourcePage: "https://commons.wikimedia.org/wiki/File:Concert.jpg",
  };
  assert.equal(isDiscoverEventBannerMediaEligible(complete), true);
  assert.equal(isDiscoverEventBannerMediaEligible({ ...complete, sourcePage: null }), false);
  assert.equal(isDiscoverEventBannerMediaEligible({ ...complete, creator: "" }), false);
});

test("documented Ticketmaster artwork requires attributed dimensions and a public source page", () => {
  const complete = {
    eventId: "show-2",
    uri: "https://s1.ticketm.net/dam/a/example.jpg",
    source: "provider",
    provider: "ticketmaster",
    attribution: "Ticketmaster / Artist partner",
    sourcePage: "https://www.ticketmaster.ca/event/example",
    width: 1_920,
    height: 1_080,
  };
  assert.equal(isDiscoverEventBannerMediaEligible(complete), true);
  assert.equal(isDiscoverEventBannerMediaEligible({ ...complete, attribution: "" }), false);
  assert.equal(isDiscoverEventBannerMediaEligible({ ...complete, sourcePage: "http://www.ticketmaster.ca/event/example" }), false);
  assert.equal(isDiscoverEventBannerMediaEligible({ ...complete, provider: "unknown" }), false);
  assert.equal(isDiscoverEventBannerMediaEligible({ ...complete, width: "1920" }), false);
});

test("event banner preserves pinned event order, prefers fan media, and keeps useful no-photo fallbacks", () => {
  const slides = buildDiscoverEventBannerSlides({
    events,
    media: [
      { eventId: "cne-2026", uri: "https://media.test/licensed.jpg", source: "organizer", rightsApproved: true },
      { artist: "The Beaches", venue: "Exhibition Place", date: "2026-08-21", uri: "https://media.test/fan.jpg", source: "fan", photosPublic: true, by: "A Fan", likes: 2 },
      { eventId: "show-2", uri: "https://media.test/blocked.jpg", source: "fan", photosPublic: true, ownerId: "blocked" },
    ],
    blockedIds: ["blocked"],
  });
  assert.equal(slides.length, 2);
  assert.equal(slides[0].title, "Canadian National Exhibition");
  assert.equal(slides[0].endDate, "2026-09-07");
  assert.equal(slides[0].media.uri, "https://media.test/fan.jpg");
  assert.equal(slides[0].media.by, "A Fan");
  assert.equal(slides[1].title, "IDLES");
  assert.equal(slides[1].media, null);
});

test("removed, moderated, duplicate, and cross-event media cannot enter the reel", () => {
  const slides = buildDiscoverEventBannerSlides({
    events: [events[0], events[0]],
    media: [
      { eventId: "other", uri: "https://media.test/wrong.jpg", source: "fan", photosPublic: true },
      { eventId: "cne-2026", uri: "https://media.test/removed.jpg", source: "fan", photosPublic: true },
      { eventId: "cne-2026", uri: "https://media.test/moderated.jpg", source: "fan", photosPublic: true, moderationStatus: "removed" },
    ],
    removedUris: ["https://media.test/removed.jpg"],
  });
  assert.equal(slides.length, 1);
  assert.equal(slides[0].media, null);
});
