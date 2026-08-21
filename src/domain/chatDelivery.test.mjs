import assert from "node:assert/strict";
import test from "node:test";

import {
  CHAT_OUTBOX_LIMIT,
  chatOutboxFor,
  chatOutboxMessageId,
  confirmedChatMessage,
  createChatClientMutationId,
  updateChatOutboxItem,
  withChatOutboxItem,
  withoutChatOutboxItem,
} from "./chatDelivery.mjs";

test("chat retry tokens are bounded, stable-format identifiers", () => {
  const id = createChatClientMutationId("fan club!", 1_725_000_000_000, 0.123456789);
  assert.match(id, /^[A-Za-z0-9_-]{8,100}$/);
  assert.equal(id, createChatClientMutationId("fan club!", 1_725_000_000_000, 0.123456789));
  assert.notEqual(id, createChatClientMutationId("fan club!", 1_725_000_000_001, 0.123456789));
});

test("the volatile outbox is bounded and account/channel scoped", () => {
  let outbox = [];
  for (let index = 0; index < CHAT_OUTBOX_LIMIT + 4; index += 1) {
    outbox = withChatOutboxItem(outbox, {
      id: `pending_${index}`,
      ownerId: index % 2 ? "u_b" : "u_a",
      kind: "dm",
      channelKey: index % 3 ? "u_a__u_c" : "u_a__u_d",
      text: `private ${index}`,
    });
  }
  assert.equal(outbox.length, CHAT_OUTBOX_LIMIT);
  assert.equal(outbox.some((item) => item.id === "pending_0"), false);
  assert.ok(chatOutboxFor(outbox, { ownerId: "u_a", kind: "dm", channelKey: "u_a__u_c" })
    .every((item) => item.ownerId === "u_a" && item.channelKey === "u_a__u_c"));
  assert.deepEqual(chatOutboxFor(outbox, { ownerId: "u_new", kind: "dm", channelKey: "u_a__u_c" }), []);
});

test("failed delivery remains retryable until confirmation or explicit cancellation", () => {
  const clientMutationId = createChatClientMutationId("dm", 123_456_789, 0.25);
  const item = {
    id: chatOutboxMessageId(clientMutationId),
    ownerId: "u_me",
    kind: "dm",
    channelKey: "u_me__u_you",
    target: "u_you",
    endpoint: "/api/dms/u_you",
    context: "Sending",
    clientMutationId,
    status: "sending",
    from: "u_me",
    text: "private body",
    pending: true,
    failed: false,
  };
  let outbox = withChatOutboxItem([], item);
  outbox = updateChatOutboxItem(outbox, item.id, { status: "failed", pending: false, failed: true });
  assert.equal(outbox[0].clientMutationId, clientMutationId, "retry keeps the original idempotency token");
  assert.equal(outbox[0].text, "private body");

  const confirmed = confirmedChatMessage(outbox[0], "dm_server");
  assert.deepEqual(confirmed, {
    id: "dm_server",
    from: "u_me",
    text: "private body",
    pending: false,
    failed: false,
    server: true,
  });
  assert.equal(confirmed.clientMutationId, undefined, "delivery metadata does not enter the confirmed cache");
  assert.deepEqual(withoutChatOutboxItem(outbox, item.id), []);
});
