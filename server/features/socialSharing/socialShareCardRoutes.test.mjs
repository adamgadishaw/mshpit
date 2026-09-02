import assert from "node:assert/strict";
import test from "node:test";

import { binaryApiResponsePayload } from "../../binaryApiResponse.js";
import {
  publicAttendanceTicketShareSnapshot,
  socialShareCardRoutes,
} from "./socialShareCardRoutes.js";
import {
  socialShareCardEtag,
  SocialShareCardBusyError,
} from "./socialShareCardRenderer.js";

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(120, 1),
]);

class TestApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function eventDocument(id = "event_123") {
  return {
    kind: "event",
    event: {
      id,
      name: "The Last Encore Tour",
      artist: "The Example",
      venue: "Massey Hall",
      place: "Toronto, Ontario, Canada",
      date: "2026-10-16",
      localTime: "19:30:00",
    },
  };
}

function reviewDocument(id = "post_123") {
  return {
    kind: "post",
    post: {
      id,
      kind: "review",
      artist: "The Example",
      venue: "Massey Hall",
      city: "Toronto",
      showDate: "2026-10-16",
      rating: 4.8,
      text: "The band sounded excellent and the crowd stayed with them all night.",
      media: [],
      author: { name: "Alex" },
    },
  };
}

function fixture({
  attendanceState = "going",
  blocked = false,
  ticket = null,
  renderer = null,
  artworkEnv = { MEDIA_PUBLIC_BASE_URL: "https://media.mshpit.test/public" },
  resolveCurrentArtistProfileImage = null,
  resolvePublicDocument = async (path) => path.startsWith("/post/")
    ? reviewDocument(path.slice("/post/".length))
    : eventDocument(path.slice("/event/".length)),
} = {}) {
  const renderedModels = [];
  const database = {
    prepare(sql) {
      assert.match(sql, /attendance_ticket/u);
      return { get: () => ({ user_id: "post_owner", kind: ticket ? "status" : "review", attendance_ticket: ticket }) };
    },
  };
  const routes = socialShareCardRoutes({
    database,
    ApiError: TestApiError,
    attendanceRepository: {
      ownExactAttendance: () => ({ attendance: { state: attendanceState } }),
    },
    blockedEitherWay: () => blocked,
    rateLimit: () => {},
    requireUser: () => ({ id: "member_123", name: "Alex" }),
    resolveCurrentArtistProfileImage,
    resolvePublicDocument,
    artworkEnv,
    renderer: renderer || {
      async render(model) {
        renderedModels.push(model);
        return { bytes: PNG, etag: '"unused-private-etag"' };
      },
    },
  });
  return { route: routes["POST /api/share-cards/render"], renderedModels };
}

function context(body) {
  const headers = {};
  return {
    body,
    setHeader: (name, value) => { headers[name] = value; },
    headers,
  };
}

test("event artwork requires the member's exact saved Going or Interested state", async () => {
  const going = fixture({ attendanceState: "going" });
  const ctx = context({ kind: "event", eventId: "event_123", intent: "going" });
  const result = binaryApiResponsePayload(await going.route(ctx));
  assert.ok(result);
  assert.equal(result.headers["Cache-Control"], "private, no-store");
  assert.equal(result.headers.Link, '<https://www.mshpit.com/event/event_123>; rel="canonical"');
  assert.equal(ctx.headers["Cache-Control"], "private, no-store");
  assert.equal(going.renderedModels[0].kicker, "Alex IS GOING");

  const mismatch = fixture({ attendanceState: "interested" });
  await assert.rejects(
    mismatch.route(context({ kind: "event", eventId: "event_123", intent: "going" })),
    (error) => error.status === 409 && error.code === "CONFLICT",
  );
  assert.equal(mismatch.renderedModels.length, 0);
});

test("public Going post falls back to its safe server-owned ticket snapshot", async () => {
  const rawTicket = {
    version: 1,
    state: "going",
    tourDateId: "event_123",
    artist: "The Example",
    venue: "Massey Hall",
    place: "Toronto, Ontario, Canada",
    date: "2026-10-16",
    startLocalTime: "19:30:00",
    eventName: "The Last Encore Tour",
    artistPhotoUri: "https://media.mshpit.test/public/artists/the-example.jpg",
    seat: { section: "PRIVATE-SECTION", row: "PRIVATE-ROW", seat: "PRIVATE-SEAT" },
    orderNumber: "PRIVATE-ORDER",
    barcode: "PRIVATE-BARCODE",
  };
  assert.deepEqual(publicAttendanceTicketShareSnapshot(rawTicket, {
    env: { MEDIA_PUBLIC_BASE_URL: "https://media.mshpit.test/public" },
  })?.fallbackArtwork, [], "an owned host/path alone must not authorize persisted artwork");
  const snapshot = publicAttendanceTicketShareSnapshot(rawTicket, {
    env: { MEDIA_PUBLIC_BASE_URL: "https://media.mshpit.test/public" },
    resolveCurrentArtistProfileImage: () => rawTicket.artistPhotoUri,
  });
  assert.deepEqual(snapshot.fallbackArtwork, [{
    url: rawTicket.artistPhotoUri,
    source: "owned-media",
  }]);
  assert.deepEqual(publicAttendanceTicketShareSnapshot({
    ...rawTicket,
    artistPhotoUri: "https://images.example.com/untrusted-artist.jpg",
  }, {
    env: { MEDIA_PUBLIC_BASE_URL: "https://media.mshpit.test/public" },
    resolveCurrentArtistProfileImage: () => "https://images.example.com/untrusted-artist.jpg",
  })?.fallbackArtwork, []);
  const serializedSnapshot = JSON.stringify(snapshot);
  for (const privateValue of [
    "PRIVATE-SECTION", "PRIVATE-ROW", "PRIVATE-SEAT", "PRIVATE-ORDER", "PRIVATE-BARCODE",
  ]) assert.doesNotMatch(serializedSnapshot, new RegExp(privateValue, "u"));

  const { route, renderedModels } = fixture({
    ticket: JSON.stringify(rawTicket),
    resolveCurrentArtistProfileImage: () => rawTicket.artistPhotoUri,
    resolvePublicDocument: async (path) => path.startsWith("/post/") ? {
      kind: "post",
      post: {
        id: "going_post",
        kind: "status",
        author: { name: "Alex" },
      },
    } : null,
  });
  const result = binaryApiResponsePayload(await route(context({ kind: "post", postId: "going_post" })));
  assert.ok(result);
  assert.equal(result.headers.Link, '<https://www.mshpit.com/post/going_post>; rel="canonical"');
  const serializedModel = JSON.stringify(renderedModels[0]);
  assert.match(serializedModel, /The Example/u);
  assert.deepEqual(renderedModels[0].artwork, [{
    url: rawTicket.artistPhotoUri,
    source: "owned-media",
  }]);
  for (const privateValue of [
    "PRIVATE-SECTION", "PRIVATE-ROW", "PRIVATE-SEAT", "PRIVATE-ORDER", "PRIVATE-BARCODE",
  ]) assert.doesNotMatch(serializedModel, new RegExp(privateValue, "u"));
});

test("persisted owned Going artwork must still be the current public artist profile image", async () => {
  const previousPhoto = "https://media.mshpit.test/public/artists/the-example/previous.jpg";
  const replacementPhoto = "https://media.mshpit.test/public/artists/the-example/current.jpg";
  const rawTicket = {
    version: 1,
    state: "going",
    tourDateId: "event_123",
    artist: "The Example",
    artistKey: "the example",
    venue: "Massey Hall",
    date: "2026-10-16",
    artistPhotoUri: previousPhoto,
  };
  const statusDocument = {
    kind: "post",
    post: {
      id: "going_post",
      kind: "status",
      author: { name: "Alex" },
    },
  };
  const resolvePublicDocument = async (path) => path.startsWith("/post/") ? statusDocument : null;
  const seenIdentities = [];
  const current = fixture({
    ticket: JSON.stringify(rawTicket),
    resolveCurrentArtistProfileImage: (identity) => {
      seenIdentities.push(identity);
      return previousPhoto;
    },
    resolvePublicDocument,
  });
  const replaced = fixture({
    ticket: JSON.stringify(rawTicket),
    resolveCurrentArtistProfileImage: () => replacementPhoto,
    resolvePublicDocument,
  });
  const removed = fixture({
    ticket: JSON.stringify(rawTicket),
    resolveCurrentArtistProfileImage: () => null,
    resolvePublicDocument,
  });
  const unreadable = fixture({
    ticket: JSON.stringify(rawTicket),
    resolveCurrentArtistProfileImage: () => { throw new Error("profile lookup unavailable"); },
    resolvePublicDocument,
  });

  await current.route(context({ kind: "post", postId: "going_post" }));
  await replaced.route(context({ kind: "post", postId: "going_post" }));
  await removed.route(context({ kind: "post", postId: "going_post" }));
  await unreadable.route(context({ kind: "post", postId: "going_post" }));

  assert.deepEqual(seenIdentities, [{ artist: "The Example", artistKey: "the example" }]);
  assert.deepEqual(current.renderedModels[0].artwork, [{ url: previousPhoto, source: "owned-media" }]);
  assert.deepEqual(replaced.renderedModels[0].artwork, []);
  assert.deepEqual(removed.renderedModels[0].artwork, []);
  assert.deepEqual(unreadable.renderedModels[0].artwork, []);
  assert.notEqual(
    socialShareCardEtag(current.renderedModels[0]),
    socialShareCardEtag(replaced.renderedModels[0]),
    "removing a stale persisted photo must create a different renderer cache key",
  );

  const providerPhoto = "https://s1.ticketm.net/dam/a/provider.jpg";
  const providerSnapshot = publicAttendanceTicketShareSnapshot({
    ...rawTicket,
    artistPhotoUri: providerPhoto,
  }, {
    resolveCurrentArtistProfileImage: () => { throw new Error("provider art must not use profile validation"); },
  });
  assert.deepEqual(providerSnapshot.fallbackArtwork, [{ url: providerPhoto, source: "ticketmaster" }]);
  const providerWithoutProfileResolver = publicAttendanceTicketShareSnapshot({
    ...rawTicket,
    artistPhotoUri: providerPhoto,
  }, {
    resolveCurrentArtistProfileImage: null,
  });
  assert.deepEqual(providerWithoutProfileResolver.fallbackArtwork, [{
    url: providerPhoto,
    source: "ticketmaster",
  }], "persisted provider art remains usable when the current artist profile has no photo resolver");
});

test("Going-post fallback rejects an impossible legacy calendar date", () => {
  assert.equal(publicAttendanceTicketShareSnapshot({
    version: 1,
    state: "going",
    tourDateId: "event_123",
    artist: "The Example",
    venue: "Massey Hall",
    date: "2026-02-31",
  }), null);
});

test("post rendering accepts a public review and rejects extra or malformed fields", async () => {
  const { route } = fixture();
  const result = binaryApiResponsePayload(await route(context({ kind: "post", postId: "post_123" })));
  assert.equal(result.headers.Link, '<https://www.mshpit.com/post/post_123>; rel="canonical"');
  await assert.rejects(
    route(context({ kind: "post", postId: "post_123", canonicalUrl: "https://tracker.example" })),
    (error) => error.status === 400 && error.code === "VALIDATION_FAILED",
  );
  await assert.rejects(
    route(context({ kind: "event", eventId: "../private", intent: "going" })),
    (error) => error.status === 400 && error.code === "VALIDATION_FAILED",
  );
  const blocked = fixture({ blocked: true });
  await assert.rejects(
    blocked.route(context({ kind: "post", postId: "post_123" })),
    (error) => error.status === 404 && error.code === "NOT_FOUND",
  );
  assert.equal(blocked.renderedModels.length, 0);
});

test("review artwork keeps its own media first and preserves an official artist fallback", async () => {
  const ownDocument = reviewDocument("review_media");
  ownDocument.image = "https://media.mshpit.test/public/users/u/review/photo.jpg";
  ownDocument.post.artistPath = "/artist/the-example";
  ownDocument.post.venuePath = "/venue/massey-hall";
  ownDocument.post.media = [{
    kind: "image",
    url: ownDocument.image,
  }];
  const fallbackPaths = [];
  const ownFixture = fixture({
    resolvePublicDocument: async (path) => {
      fallbackPaths.push(path);
      if (path.startsWith("/post/")) return ownDocument;
      if (path === "/artist/the-example") {
        return {
          kind: "artist",
          artist: { name: "The Example" },
          image: "https://media.mshpit.test/public/artists/the-example/banner.jpg",
          imageProvenance: "entity-profile",
          reviews: [],
        };
      }
      if (path === "/venue/massey-hall") {
        return {
          kind: "venue",
          image: "https://media.mshpit.test/public/users/another-fan/venue.jpg",
          imageProvenance: "fan-gallery",
          posts: [{ media: [{ kind: "image", url: "https://media.mshpit.test/public/users/another-fan/venue.jpg" }] }],
        };
      }
      return null;
    },
  });
  await ownFixture.route(context({ kind: "post", postId: "review_media" }));
  assert.deepEqual(ownFixture.renderedModels[0].artwork, [
    { url: ownDocument.image, source: "owned-media" },
    {
      url: "https://media.mshpit.test/public/artists/the-example/banner.jpg",
      source: "owned-media",
    },
  ]);
  assert.deepEqual(fallbackPaths, ["/post/review_media", "/artist/the-example", "/venue/massey-hall"]);
});

test("review artwork rejects cross-user artist and venue gallery fallbacks", async () => {
  const fallbackPaths = [];
  const fallbackFixture = fixture({
    resolvePublicDocument: async (path) => {
      fallbackPaths.push(path);
      if (path === "/post/review_fallback") {
        const document = reviewDocument("review_fallback");
        document.post.artistPath = "/artist/the-example";
        document.post.venuePath = "/venue/massey-hall";
        return document;
      }
      if (path === "/artist/the-example") {
        return {
          kind: "artist",
          artist: { name: "The Example" },
          image: "https://media.mshpit.test/public/users/another-fan/artist.jpg",
          imageProvenance: "fan-gallery",
          reviews: [{
            media: [{
              kind: "image",
              url: "https://media.mshpit.test/public/users/another-fan/artist.jpg",
            }],
          }],
        };
      }
      if (path === "/venue/massey-hall") {
        return {
          kind: "venue",
          image: "https://media.mshpit.test/public/users/another-fan/venue.jpg",
          imageProvenance: "fan-gallery",
          posts: [{
            media: [{
              kind: "image",
              url: "https://media.mshpit.test/public/users/another-fan/venue.jpg",
            }],
          }],
        };
      }
      return null;
    },
  });
  await fallbackFixture.route(context({ kind: "post", postId: "review_fallback" }));
  assert.deepEqual(fallbackFixture.renderedModels[0].artwork, []);
  assert.deepEqual(fallbackPaths, ["/post/review_fallback", "/artist/the-example", "/venue/massey-hall"]);
});

test("review artwork can use the exact public concert's Ticketmaster image", async () => {
  const providerUrl = "https://s1.ticketm.net/dam/a/review-concert.jpg";
  const document = reviewDocument("review_provider_fallback");
  document.post.concertPath = "/concert/show.review-provider";
  document.post.artistPath = "/artist/the-example";
  const fallbackPaths = [];
  const providerFixture = fixture({
    resolvePublicDocument: async (path) => {
      fallbackPaths.push(path);
      if (path === "/post/review_provider_fallback") return document;
      if (path === "/concert/show.review-provider") {
        return {
          kind: "concert",
          concert: {
            providerImage: {
              url: providerUrl,
              attribution: "Ticketmaster / promoter",
              sourcePage: "https://www.ticketmaster.com/event/provider-review",
            },
          },
        };
      }
      return null;
    },
  });

  await providerFixture.route(context({ kind: "post", postId: "review_provider_fallback" }));

  assert.deepEqual(providerFixture.renderedModels[0].artwork, [{
    url: providerUrl,
    source: "ticketmaster",
  }]);
  assert.deepEqual(fallbackPaths, [
    "/post/review_provider_fallback",
    "/concert/show.review-provider",
    "/artist/the-example",
  ]);
});

test("event artwork keeps Ticketmaster art, strips fan-gallery primaries, and can fall back to an official artist profile", async () => {
  const providerUrl = "https://s1.ticketm.net/dam/a/111/provider-event.jpg";
  const fanUrl = "https://media.mshpit.test/public/users/another-fan/event.jpg";
  const document = eventDocument("event_provider");
  document.image = providerUrl;
  document.imageProvenance = "provider";
  document.event.artistPath = "/artist/the-example";
  document.event.venuePath = "/venue/massey-hall";
  document.event.providerImage = { url: providerUrl };
  document.posts = [{ media: [{ kind: "image", url: fanUrl }] }];

  const eventFixture = fixture({
    resolvePublicDocument: async (path) => {
      if (path === "/event/event_provider") return document;
      if (path === "/artist/the-example") {
        return {
          kind: "artist",
          artist: { name: "The Example" },
          image: "https://media.mshpit.test/public/artists/the-example/avatar.jpg",
          imageProvenance: "entity-profile",
          reviews: [],
        };
      }
      if (path === "/venue/massey-hall") {
        return {
          kind: "venue",
          image: "https://media.mshpit.test/public/users/another-fan/venue.jpg",
          imageProvenance: "fan-gallery",
        };
      }
      return null;
    },
  });
  await eventFixture.route(context({
    kind: "event",
    eventId: "event_provider",
    intent: "going",
  }));
  assert.deepEqual(eventFixture.renderedModels[0].artwork, [
    { url: providerUrl, source: "ticketmaster" },
    {
      url: "https://media.mshpit.test/public/artists/the-example/avatar.jpg",
      source: "owned-media",
    },
  ]);
  assert.equal(eventFixture.renderedModels[0].artwork.some(({ url }) => url === fanUrl), false);

  const fanDocument = eventDocument("event_fan_gallery");
  fanDocument.image = fanUrl;
  fanDocument.imageProvenance = "fan-gallery";
  const fanFixture = fixture({
    resolvePublicDocument: async (path) => path === "/event/event_fan_gallery" ? fanDocument : null,
  });
  await fanFixture.route(context({
    kind: "event",
    eventId: "event_fan_gallery",
    intent: "going",
  }));
  assert.deepEqual(fanFixture.renderedModels[0].artwork, []);
});

test("renderer saturation reports a dedicated retryable service failure", async () => {
  const { route } = fixture({
    renderer: {
      async render() { throw new SocialShareCardBusyError(); },
    },
  });
  await assert.rejects(
    route(context({ kind: "event", eventId: "event_123", intent: "going" })),
    (error) => error.status === 503 && error.code === "SHARE_RENDER_UNAVAILABLE",
  );
});
