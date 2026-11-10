import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as delivery from "./chatDelivery.mjs";
import { mergeChatMessages } from "./chatMessages.mjs";
import { createIOSMessageDrafts } from "./iosMessageDrafts.mjs";

// Exercise the production Store delivery commands with controlled transport and
// account/cache bindings. No React renderer, real account or network is needed.
const store = readFileSync(new URL("../store.js", import.meta.url), "utf8");
const commands = store.slice(store.indexOf("  const commitConfirmedChatMessage ="),
  store.indexOf("  // --- Concert Lounge"));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const itemFor = (index = 1) => ({
  id: `pending_dm_${index}`, clientMutationId: `dm_intent_${index}`, ownerId: "me", authEpoch: 1,
  kind: "dm", channelKey: "me__friend", target: "friend", endpoint: "/api/dms/friend",
  context: "Sending your direct message", status: "queued", from: "me", text: `hello ${index}`,
  at: 900, ts: "now", pending: true, failed: false,
});
function fixture(apiCall) {
  const sessionRef = { current: { id: "me" } }, chatAuthEpochRef = { current: 1 };
  const chatOutboxRef = { current: [] }, confirmed = { dm: {}, fan: {}, lounge: {} }, requests = [];
  const bindings = {
    ...delivery, mergeChatMessages, sessionRef, chatAuthEpochRef, chatOutboxRef,
    ago: (at) => `canonical:${at}`,
    commitChatOutbox: (update) => (chatOutboxRef.current = update(chatOutboxRef.current)),
    setDms: (update) => { confirmed.dm = update(confirmed.dm); },
    setFanClubMsgs: (update) => { confirmed.fan = update(confirmed.fan); },
    setLounge: (update) => { confirmed.lounge = update(confirmed.lounge); },
    api: async (path, options) => { requests.push({ path, ...options }); return apiCall(path, options); },
  };
  const functions = new Function(...Object.keys(bindings), `${commands}\nreturn { queueChatMessage, retryChatMessage, cancelChatMessage };`)(...Object.values(bindings));
  return { ...functions, requests, confirmed, sessionRef, chatAuthEpochRef, chatOutboxRef };
}

test("a full outbox rejects admission without sending, displacing messages or clearing the draft", async () => {
  const f = fixture(() => assert.fail("full queue must not dispatch"));
  f.chatOutboxRef.current = Array.from({ length: delivery.CHAT_OUTBOX_LIMIT }, (_, i) => itemFor(i));
  const before = f.chatOutboxRef.current;
  const drafts = createIOSMessageDrafts(); drafts.account("me", 1);
  const draft = drafts.lease("friend"); draft.edit("new draft"); const claim = draft.claim();
  const result = await f.queueChatMessage({ ...itemFor(101), text: claim.text });
  draft.settle(claim, result);
  assert.equal(result.ok, false); assert.equal(result.queueFull, true); assert.equal(result.queued, false);
  assert.match(result.deliveryMessage, /Too many messages/);
  assert.equal(result.localId, undefined);
  assert.equal(f.chatOutboxRef.current, before);
  assert.deepEqual(draft.read(), { text: "new draft", sending: false });
  assert.equal(f.requests.length, 0);
});

test("lost response retries the identical intent and adopts canonical acknowledgement time", async () => {
  let attempt = 0;
  const f = fixture(() => {
    if (++attempt === 1) throw Object.assign(new Error("lost response"), { code: "PIT-NET-002" });
    return { id: "server_1", createdAt: 300, duplicate: true };
  });
  const item = itemFor();
  const first = await f.queueChatMessage(item);
  assert.equal(first.deliveryState, "unconfirmed"); assert.equal(first.retryable, true);
  assert.equal(f.chatOutboxRef.current[0].clientMutationId, item.clientMutationId);
  const retry = await f.retryChatMessage(item.id);
  assert.equal(retry.ok, true); assert.deepEqual(f.requests[0].body, f.requests[1].body);
  assert.equal(f.requests[1].expectedAccountId, "me");
  assert.deepEqual(f.chatOutboxRef.current, []);
  const confirmed = f.confirmed.dm[item.channelKey][0];
  assert.equal(confirmed.id, "server_1"); assert.equal(confirmed.at, 300); assert.equal(confirmed.ts, "canonical:300");
  assert.equal(confirmed.deliveryState, undefined); assert.equal(confirmed.clientMutationId, undefined);
});

test("permanent rejection prevents another unchanged send and still permits local dismissal", async () => {
  const f = fixture(() => { throw { status: 403, retryable: true }; });
  const first = await f.queueChatMessage(itemFor());
  assert.equal(first.deliveryState, "rejected"); assert.equal(first.retryable, false);
  const second = await f.retryChatMessage(first.localId);
  assert.equal(second.ok, false); assert.equal(second.retryable, false); assert.equal(f.requests.length, 1);
  assert.equal(f.cancelChatMessage(first.localId), true); assert.deepEqual(f.chatOutboxRef.current, []);
});

test("rate-limit deadline prevents early retry without deleting the original intent", async () => {
  const retryAt = Date.now() + 60_000;
  const f = fixture(() => { throw { status: 429, retryAt }; });
  const first = await f.queueChatMessage(itemFor());
  assert.equal(first.deliveryState, "retry_later"); assert.equal(first.retryAt, retryAt);
  const retry = await f.retryChatMessage(first.localId);
  assert.equal(retry.retryAt, retryAt); assert.equal(f.requests.length, 1);
  assert.equal(f.chatOutboxRef.current[0].clientMutationId, itemFor().clientMutationId);
});

test("an uncertain attempt stays uncertain when a later retry loses access", async () => {
  let attempt = 0;
  const f = fixture(() => { throw ++attempt === 1 ? { status: 503 } : { status: 403 }; });
  const first = await f.queueChatMessage(itemFor());
  const retry = await f.retryChatMessage(first.localId);
  assert.equal(retry.deliveryState, "unconfirmed"); assert.equal(retry.deliveryUncertain, true);
  assert.equal(retry.retryable, false); assert.match(retry.deliveryMessage, /Delivery unconfirmed/);
  await f.retryChatMessage(first.localId); assert.equal(f.requests.length, 2);
});

test("missing or malformed success acknowledgements never clear a pending intent", async () => {
  for (const ack of [null, {}, { id: 123 }, { id: "   " }]) {
    const f = fixture(() => ack);
    const result = await f.queueChatMessage(itemFor());
    assert.equal(result.ok, false); assert.equal(result.deliveryState, "unconfirmed");
    assert.equal(f.chatOutboxRef.current.length, 1); assert.deepEqual(f.confirmed.dm, {});
  }
});

test("a same-account replacement epoch cannot dismiss a previous epoch's failed intent", async () => {
  const f = fixture(() => { throw { status: 403 }; });
  const result = await f.queueChatMessage(itemFor());
  f.chatAuthEpochRef.current = 2;
  assert.equal(f.cancelChatMessage(result.localId), false);
  assert.equal(f.chatOutboxRef.current.length, 1);
});

test("overlapping retry calls issue one request and preserve the same mutation ID", async () => {
  const request = deferred(), f = fixture(() => request.promise), item = itemFor();
  const send = f.queueChatMessage(item);
  const overlapping = await f.retryChatMessage(item.id);
  assert.equal(overlapping.pending, true); assert.equal(f.requests.length, 1);
  request.resolve({ id: "confirmed" }); assert.equal((await send).ok, true);
});

for (const outcome of ["success", "failure"]) {
  test(`stale ${outcome} and retry cannot affect a replacement authentication epoch`, async () => {
    const request = deferred(), f = fixture(() => request.promise), item = itemFor();
    const send = f.queueChatMessage(item);
    f.chatAuthEpochRef.current = 2;
    const retry = await f.retryChatMessage(item.id);
    assert.equal(retry.stale, true); assert.equal(f.requests.length, 1);
    if (outcome === "success") request.resolve({ id: "old_account_message" });
    else request.reject({ status: 503 });
    assert.equal((await send).stale, true);
    assert.deepEqual(f.confirmed.dm, {});
    assert.equal(f.chatOutboxRef.current[0].status, "sending", "retired completion does not mutate current state");
  });
}
