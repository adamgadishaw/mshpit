import assert from "node:assert/strict";
import test from "node:test";

import { binaryApiResponsePayload } from "../../binaryApiResponse.js";
import {
  publicAttendanceTicketShareSnapshot,
  socialShareCardRoutes,
} from "./socialShareCardRoutes.js";
import { SocialShareCardBusyError } from "./socialShareCardRenderer.js";

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
    resolvePublicDocument,
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
    seat: { section: "PRIVATE-SECTION", row: "PRIVATE-ROW", seat: "PRIVATE-SEAT" },
    orderNumber: "PRIVATE-ORDER",
    barcode: "PRIVATE-BARCODE",
  };
  const snapshot = publicAttendanceTicketShareSnapshot(rawTicket);
  const serializedSnapshot = JSON.stringify(snapshot);
  for (const privateValue of [
    "PRIVATE-SECTION", "PRIVATE-ROW", "PRIVATE-SEAT", "PRIVATE-ORDER", "PRIVATE-BARCODE",
  ]) assert.doesNotMatch(serializedSnapshot, new RegExp(privateValue, "u"));

  const { route, renderedModels } = fixture({
    ticket: JSON.stringify(rawTicket),
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
  for (const privateValue of [
    "PRIVATE-SECTION", "PRIVATE-ROW", "PRIVATE-SEAT", "PRIVATE-ORDER", "PRIVATE-BARCODE",
  ]) assert.doesNotMatch(serializedModel, new RegExp(privateValue, "u"));
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
