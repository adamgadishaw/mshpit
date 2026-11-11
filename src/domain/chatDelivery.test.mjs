import assert from "node:assert/strict";
import test from "node:test";

import {
  CHAT_OUTBOX_LIMIT,
  chatDeliveryFailure,
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
  assert.equal(outbox.some((item) => item.id === "pending_0"), true, "capacity never evicts an earlier unsent message");
  assert.equal(outbox.some((item) => item.id === "pending_100"), false, "the new message is rejected instead");
  assert.ok(chatOutboxFor(outbox, { ownerId: "u_a", kind: "dm", channelKey: "u_a__u_c" })
    .every((item) => item.ownerId === "u_a" && item.channelKey === "u_a__u_c"));
  assert.deepEqual(chatOutboxFor(outbox, { ownerId: "u_new", kind: "dm", channelKey: "u_a__u_c" }), []);
});

test("full outbox can still replace or resolve an existing item without displacing its neighbours", () => {
  const one = { id: "one", ownerId: "me", kind: "dm", channelKey: "friend", text: "first" };
  const two = { ...one, id: "two", text: "second" };
  const full = withChatOutboxItem([one], two, 2);
  const replacement = { ...one, failed: true };
  assert.deepEqual(withChatOutboxItem(full, replacement, 2), [replacement, two]);
  const three = { ...one, id: "three" };
  assert.equal(withChatOutboxItem(full, three, 2), full);
  assert.deepEqual(withChatOutboxItem(withoutChatOutboxItem(full, "two"), three, 2), [one, three]);
});

test("delivery classification separates rejection, waiting, authentication and uncertain outcomes", () => {
  for (const status of [400, 403, 404, 410, 413, 415, 422]) {
    const failure = chatDeliveryFailure({ status, retryable: true });
    assert.equal(failure.deliveryState, "rejected", `status ${status}`);
    assert.equal(failure.retryable, false);
    assert.equal(failure.deliveryUncertain, false);
  }
  assert.equal(chatDeliveryFailure({ status: 401 }).deliveryState, "auth_required");
  for (const status of [425, 429]) {
    const failure = chatDeliveryFailure({ status, retryAt: 200 }, { now: 100 });
    assert.equal(failure.deliveryState, "retry_later");
    assert.equal(failure.retryable, true);
    assert.equal(failure.retryAt, 200);
  }
  for (const error of [new Error("lost response"), { status: 408 }, { status: 500 }, { status: 503 },
    { code: "PIT-NET-001", status: 403 }, { code: "PIT-NET-002", status: 200 },
    { code: "PIT-API-001", status: 200, retryable: false }]) {
    const failure = chatDeliveryFailure(error);
    assert.equal(failure.deliveryState, "unconfirmed");
    assert.equal(failure.deliveryUncertain, true);
    assert.equal(failure.retryable, true);
  }
  const conflict = chatDeliveryFailure({ status: 409 });
  assert.equal(conflict.deliveryState, "unconfirmed", "conflict can mean the original message was removed");
  assert.equal(conflict.retryable, false);
});

test("an earlier unconfirmed attempt cannot become definitely unsent after a later rejection", () => {
  for (const status of [401, 403, 409, 429]) {
    const failure = chatDeliveryFailure({ status }, { previouslyUnconfirmed: true });
    assert.equal(failure.deliveryUncertain, true);
    assert.match(failure.deliveryMessage, /Delivery unconfirmed/);
  }
  const identity = chatDeliveryFailure({ status: 409, serverCode: "IDENTITY_CHANGED" });
  assert.equal(identity.deliveryUncertain, true, "identity can change after the server committed");
  assert.equal(identity.retryable, false);
});

test("confirmation adopts canonical server time and removes transient delivery metadata", () => {
  const item = { id: "local", text: "hello", at: 900, ...chatDeliveryFailure({ status: 503 }) };
  const confirmed = confirmedChatMessage(item, { id: "server", createdAt: 300 });
  assert.equal(confirmed.at, 300);
  assert.equal(confirmed.deliveryState, undefined);
  assert.equal(confirmed.deliveryUncertain, undefined);
  assert.equal(confirmed.retryable, undefined);
  assert.equal(confirmed.retryAt, undefined);
  assert.equal(confirmedChatMessage(item, { id: "server", createdAt: "invalid" }).at, 900);
  assert.equal(confirmedChatMessage(item, { id: "server" }).at, 900, "old server response remains compatible");
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
