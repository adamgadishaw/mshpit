import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAttendanceShareModel,
  buildPostShareModel,
  socialShareFileName,
  socialShareIntentUrl,
} from "./socialShareCard.mjs";

test("a Going post share uses the canonical post and an explicit private render request", () => {
  const model = buildPostShareModel({
    id: "p_ticket_1",
    kind: "status",
    review: "Meet you inside.",
    attendanceTicket: {
      kind: "attendance-ticket",
      eventTitle: "Little Simz",
      contextTitle: "Lotus Tour",
      venue: "History",
      city: "Toronto",
      dateLabel: "WED · SEP 16 · 2026",
      timing: [{ kind: "start", label: "SHOW START", value: "8:00 PM" }],
      imageUri: "https://images.mshpit.com/little-simz.jpg",
      seatLocation: { section: "102", row: "A", seat: "7" },
    },
  }, { author: { name: "Adam" } });

  assert.equal(model.kind, "going");
  assert.equal(model.url, "https://www.mshpit.com/post/p_ticket_1");
  assert.deepEqual(model.renderRequest, { kind: "post", postId: "p_ticket_1" });
  assert.equal(model.artworkUri, "https://images.mshpit.com/little-simz.jpg");
  assert.match(model.shareText, /Adam is going to Little Simz/);
  assert.equal(model.dateLabel, "WED · SEP 16 · 2026");
  assert.equal(model.timeLabel, "8:00 PM");
  assert.equal(Object.hasOwn(model, "seatLocation"), false);
  assert.equal(JSON.stringify(model).includes('"section"'), false);
  assert.equal(JSON.stringify(model).includes('"seat"'), false);
});

test("a Review share keeps its public summary concise and uses a video poster as artwork", () => {
  const model = buildPostShareModel({
    id: "review_42",
    kind: "review",
    artist: "J. Cole",
    tour: "The Fall-Off Tour",
    venue: "Scotiabank Arena",
    city: "Toronto",
    date: "2026-07-28",
    overall: 4.75,
    review: "A focused set with a huge closing run. ".repeat(12),
    media: [{
      kind: "video",
      uri: "https://media.mshpit.com/review.mp4",
      posterUri: "https://media.mshpit.com/review-poster.jpg",
    }],
  }, { author: { handle: "pitfan" } });

  assert.equal(model.kind, "review");
  assert.equal(model.eyebrow, "REVIEW");
  assert.equal(model.url, "https://www.mshpit.com/post/review_42");
  assert.deepEqual(model.renderRequest, { kind: "post", postId: "review_42" });
  assert.equal(model.rating, 4.75);
  assert.equal(model.artworkUri, "https://media.mshpit.com/review-poster.jpg");
  assert.ok(model.quote.length <= 180);
  assert.match(model.shareText, /4\.8 out of 5/);
});

test("Going and Interested event cards use exact event identity and never invent a public image URL", () => {
  const show = {
    id: "show-key",
    tourDateId: "tm:event:900",
    artistName: "Bryson Tiller",
    eventTitle: "Bryson Tiller",
    tourName: "The Vices Tour",
    venueName: "RBC Amphitheatre",
    cityName: "Toronto",
    date: "2026-09-16",
    startTime: "20:00",
    artistPhotoUri: "https://images.mshpit.com/bryson.jpg",
  };
  const going = buildAttendanceShareModel({ show, state: "going", author: { name: "Adam" } });
  const interested = buildAttendanceShareModel({ show, state: "interested" });

  assert.equal(going.url, "https://www.mshpit.com/event/tm%3Aevent%3A900");
  assert.deepEqual(going.renderRequest, { kind: "event", eventId: "tm:event:900", intent: "going" });
  assert.deepEqual(interested.renderRequest, { kind: "event", eventId: "tm:event:900", intent: "interested" });
  assert.equal("imageUrl" in going, false);
  assert.match(interested.shareText, /interested in Bryson Tiller/);
});

test("direct social intents share only the canonical page and web never invents an Instagram composer", () => {
  const model = buildPostShareModel({ id: "p1", kind: "review", artist: "SZA", venue: "History", date: "2026-08-20", overall: 5 });
  const x = new URL(socialShareIntentUrl("x", model));
  const facebook = new URL(socialShareIntentUrl("facebook", model));

  assert.equal(x.hostname, "twitter.com");
  assert.equal(x.searchParams.get("url"), model.url);
  assert.equal(facebook.hostname, "www.facebook.com");
  assert.equal(facebook.searchParams.get("u"), model.url);
  assert.equal(socialShareIntentUrl("instagram", model), null);
  assert.equal(socialShareFileName(model), "mshpit-review-p1.png");
});

test("share models fail closed without a durable public identity", () => {
  assert.equal(buildPostShareModel({ kind: "review", artist: "SZA", overall: 5 }), null);
  assert.equal(buildPostShareModel({ id: "plain-status", artist: "SZA", overall: 5 }), null);
  assert.equal(buildPostShareModel({ id: "empty-review", kind: "review", artist: "SZA" }), null);
  assert.equal(buildAttendanceShareModel({ show: { eventTitle: "SZA" }, state: "going" }), null);
  assert.equal(buildAttendanceShareModel({ show: { id: "internal-show-id", providerEventId: "provider:42", eventTitle: "SZA" }, state: "going" }), null);
  assert.equal(buildAttendanceShareModel({ show: { id: "event", eventTitle: "SZA" }, state: "here" }), null);
  assert.equal(buildPostShareModel({ id: "review 42", kind: "review", artist: "SZA", overall: 5 }), null);
  assert.equal(buildPostShareModel({ id: "review/42", kind: "review", artist: "SZA", overall: 5 }), null);
  assert.equal(buildPostShareModel({ id: "a".repeat(201), kind: "review", artist: "SZA", overall: 5 }), null);
  assert.equal(buildAttendanceShareModel({ show: { tourDateId: "event/42", eventTitle: "SZA" }, state: "going" }), null);
  assert.equal(buildAttendanceShareModel({ show: { tourDateId: "e".repeat(201), eventTitle: "SZA" }, state: "interested" }), null);
});

test("share identity applies NFKC and trim without truncating", () => {
  const post = buildPostShareModel({ id: "  ｐｏｓｔ：42  ", kind: "review", artist: "SZA", overall: 5 });
  assert.equal(post.id, "post:42");
  assert.deepEqual(post.renderRequest, { kind: "post", postId: "post:42" });
});
