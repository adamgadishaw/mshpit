import assert from "node:assert/strict";
import test from "node:test";
import { filterInboxConversations, inboxPreview, inboxUnreadLabel } from "./inboxPresentation.mjs";

function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

const conversations = freeze([
  {
    id: "zoe",
    otherUser: { name: "Zoë García", handle: "@nightowl" },
    last: { from: "zoe", text: "Meet at the north gate" },
  },
  {
    id: "sam",
    otherUser: { name: "Sam Patel", handle: "@drummer" },
    last: { from: "sam", text: "Bring earplugs for the show" },
    messages: [{ text: "The soundcheck starts at four" }],
  },
  {
    id: "riley",
    otherUser: { name: "Riley Chen", handle: "@northside" },
    last: { from: "riley", text: "Meet at the north gate after the show" },
  },
]);

const ids = threads => threads.map(thread => thread.id);

test("inbox filtering finds people by name or handle regardless of case and accents", () => {
  assert.deepEqual(ids(filterInboxConversations(conversations, "zOe gArCiA")), ["zoe"]);
  assert.deepEqual(ids(filterInboxConversations(conversations, "Zoe\u0308 Garci\u0301a")), ["zoe"]);
  assert.deepEqual(ids(filterInboxConversations(conversations, "@DRUMMER")), ["sam"]);
  assert.deepEqual(ids(filterInboxConversations(conversations, "nightowl")), ["zoe"]);
});

test("all search words must match the conversation summary, including across fields", () => {
  assert.deepEqual(ids(filterInboxConversations(conversations, "  zoe\n NORTH\tgate  ")), ["zoe"]);
  assert.deepEqual(ids(filterInboxConversations(conversations, "zoe earplugs")), []);
  assert.deepEqual(ids(filterInboxConversations(conversations, "north gate")), ["zoe", "riley"]);
});

test("inbox search includes the latest preview without pretending to search older messages", () => {
  assert.deepEqual(ids(filterInboxConversations(conversations, "earplugs")), ["sam"]);
  assert.deepEqual(ids(filterInboxConversations(conversations, "soundcheck")), []);
});

test("clearing search restores the original ordering without mutating conversations", () => {
  const before = structuredClone(conversations);
  assert.deepEqual(ids(filterInboxConversations(conversations, "gate")), ["zoe", "riley"]);
  for (const query of ["", "   ", "\n\t "]) {
    assert.deepEqual(filterInboxConversations(conversations, query), before);
  }
  assert.deepEqual(conversations, before);
});

test("a conversation with no latest message remains searchable by its participant", () => {
  const empty = { id: "morgan", otherUser: { name: "Morgan Lee", handle: "@morgan" } };
  assert.deepEqual(filterInboxConversations([empty], "morgan"), [empty]);
  assert.deepEqual(filterInboxConversations([empty], "earplugs"), []);
  assert.equal(inboxPreview(empty, "me"), "Start a conversation");
});

test("normal previews identify outgoing messages without inventing delivery receipts", () => {
  assert.equal(inboxPreview({ last: { from: "me", text: "Meet at the doors" } }, "me"), "You: Meet at the doors");
  assert.equal(inboxPreview({ last: { from: "zoe", text: "Meet at the doors" } }, "me"), "Meet at the doors");
});

test("pending and unsuccessful outgoing previews expose their actual send state", () => {
  const cases = [
    [{ pending: true }, "Sending: Meet at the doors"],
    [{ failed: true }, "Not sent: Meet at the doors"],
    [{ failed: true, deliveryState: "unconfirmed", deliveryUncertain: true }, "Not confirmed: Meet at the doors"],
    [{ failed: true, deliveryState: "rejected", retryable: false }, "Couldn’t send: Meet at the doors"],
    [{ failed: true, deliveryState: "retry_later" }, "Try again later: Meet at the doors"],
    [{ failed: true, deliveryState: "auth_required", deliveryUncertain: true, retryable: false }, "Sign in to send: Meet at the doors"],
  ];

  for (const [state, expected] of cases) {
    const preview = inboxPreview({ last: { from: "me", text: "Meet at the doors", ...state } }, "me");
    assert.equal(preview, expected);
    assert.doesNotMatch(preview, /\b(?:read|delivered|seen)\b/i);
  }
});

test("a lost acknowledgement is not presented as a definite failure or successful delivery", () => {
  const preview = inboxPreview({
    last: { from: "me", text: "Meet at the doors", failed: true, deliveryState: "unconfirmed" },
  }, "me");
  assert.match(preview, /^Not confirmed:/);
  assert.doesNotMatch(preview, /Not sent|Couldn.t send|\b(?:read|delivered|seen)\b/i);
});

test("multiline message previews stay readable on one line", () => {
  assert.equal(inboxPreview({ last: { from: "me", text: "  North gate\n\n after\t the show  " } }, "me"), "You: North gate after the show");
});

test("unread labels show actual counts through 99 and cap larger counts", () => {
  for (const count of [0, 1, 2, 12, 42, 99]) {
    assert.equal(inboxUnreadLabel(count), String(count));
  }
  assert.equal(inboxUnreadLabel(100), "99+");
  assert.equal(inboxUnreadLabel(238), "99+");
});

test("missing or negative unread counts do not display phantom unread messages", () => {
  assert.equal(inboxUnreadLabel(undefined), "0");
  assert.equal(inboxUnreadLabel(null), "0");
  assert.equal(inboxUnreadLabel(-1), "0");
});
