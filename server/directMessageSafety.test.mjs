import test from "node:test";
import assert from "node:assert/strict";
import { isClassifiedAccountAgeBand, mayStartDirectMessage } from "./directMessageSafety.js";

// Explicit product-contract truth table, independent of the helper's branching.
// Each mask lists: no follows, sender only, recipient only, mutual follows.
// Columns list Nobody / People I follow / Mutuals for new then existing chats.
const permissionMatrix = [
  ["18_plus", "18_plus", ["0000", "0011", "0001", "1111", "1111", "1111"]],
  ["18_plus", "13_17",   ["0000", "0001", "0001", "0001", "0001", "0001"]],
  ["18_plus", "unknown", ["0000", "0001", "0001", "0001", "0001", "0001"]],
  ["13_17", "18_plus",   ["0000", "0001", "0001", "0001", "0001", "0001"]],
  ["13_17", "13_17",     ["0000", "0001", "0001", "0001", "0001", "0001"]],
  ["13_17", "unknown",   ["0000", "0001", "0001", "0001", "0001", "0001"]],
  ["unknown", "18_plus", ["0000", "0000", "0000", "0000", "0000", "0000"]],
  ["unknown", "13_17",   ["0000", "0000", "0000", "0000", "0000", "0000"]],
  ["unknown", "unknown", ["0000", "0000", "0000", "0000", "0000", "0000"]],
];
const policyColumns = [
  [false, "nobody"], [false, "people_i_follow"], [false, "mutuals"],
  [true, "nobody"], [true, "people_i_follow"], [true, "mutuals"],
];
const followColumns = [[false, false], [true, false], [false, true], [true, true]];

for (const [senderAgeBand, recipientAgeBand, masks] of permissionMatrix) {
  test(`all policies, chat states and follow directions: ${senderAgeBand} to ${recipientAgeBand}`, () => {
    for (const [column, [conversationExists, recipientPolicy]] of policyColumns.entries()) {
      for (const [direction, [senderFollowsRecipient, recipientFollowsSender]] of followColumns.entries()) {
        const input = { senderAgeBand, recipientAgeBand, conversationExists, recipientPolicy,
          senderFollowsRecipient, recipientFollowsSender };
        assert.equal(mayStartDirectMessage(input).allowed, masks[column][direction] === "1", JSON.stringify(input));
      }
    }
  });
}

test("first-contact closure never replaces the sender's required age-classification reason", () => {
  assert.deepEqual(mayStartDirectMessage({ recipientPolicy: "nobody", senderAgeBand: "unknown",
    recipientAgeBand: "13_17", senderFollowsRecipient: true, recipientFollowsSender: true }),
  { allowed: false, reason: "age_classification_required" });
  assert.deepEqual(mayStartDirectMessage({ recipientPolicy: "nobody", senderAgeBand: "18_plus",
    recipientAgeBand: "unknown", senderFollowsRecipient: true, recipientFollowsSender: true }),
  { allowed: false, reason: "recipient_closed" });
});

test("missing or invalid safety fields retain conservative normalization", () => {
  for (const value of [undefined, null, "", "adult"]) {
    assert.deepEqual(mayStartDirectMessage({ conversationExists: true, recipientPolicy: "nobody",
      senderAgeBand: value, recipientAgeBand: "18_plus", senderFollowsRecipient: true, recipientFollowsSender: true }),
    { allowed: false, reason: "age_classification_required" });
    assert.equal(mayStartDirectMessage({ senderAgeBand: "18_plus", recipientAgeBand: value,
      recipientPolicy: "people_i_follow", recipientFollowsSender: true }).allowed, false);
    assert.equal(mayStartDirectMessage({ senderAgeBand: "18_plus", recipientAgeBand: value,
      recipientPolicy: "people_i_follow", recipientFollowsSender: true, senderFollowsRecipient: true }).allowed, true);
    assert.equal(mayStartDirectMessage({ senderAgeBand: "18_plus", recipientAgeBand: "18_plus",
      recipientPolicy: value, recipientFollowsSender: true }).allowed, false);
    assert.equal(mayStartDirectMessage({ senderAgeBand: "18_plus", recipientAgeBand: "18_plus",
      recipientPolicy: value, recipientFollowsSender: true, senderFollowsRecipient: true }).allowed, true);
  }
});

test("existing adult conversations remain writable after first contact closes", () => assert.equal(mayStartDirectMessage({
  conversationExists: true,
  recipientPolicy: "nobody",
  senderAgeBand: "18_plus",
  recipientAgeBand: "18_plus",
}).allowed, true));
test("existing conversations still enforce age classification and teen mutuals", () => {
  assert.equal(mayStartDirectMessage({
    conversationExists: true,
    senderAgeBand: "unknown",
    recipientAgeBand: "18_plus",
  }).allowed, false);
  assert.equal(mayStartDirectMessage({
    conversationExists: true,
    senderAgeBand: "18_plus",
    recipientAgeBand: "13_17",
  }).allowed, false);
  assert.equal(mayStartDirectMessage({
    conversationExists: true,
    senderAgeBand: "18_plus",
    recipientAgeBand: "13_17",
    senderFollowsRecipient: true,
    recipientFollowsSender: true,
  }).allowed, true);
});
test("nobody blocks first contact", () => assert.equal(mayStartDirectMessage({ recipientPolicy: "nobody", senderAgeBand: "18_plus", recipientAgeBand: "18_plus", recipientFollowsSender: true }).allowed, false));
test("people I follow admits only a followed sender", () => {
  assert.equal(mayStartDirectMessage({ recipientPolicy: "people_i_follow", senderAgeBand: "18_plus", recipientAgeBand: "18_plus", recipientFollowsSender: true }).allowed, true);
  assert.equal(mayStartDirectMessage({ recipientPolicy: "people_i_follow", senderAgeBand: "18_plus", recipientAgeBand: "18_plus" }).allowed, false);
});
test("teen first contact requires mutual follows", () => {
  assert.equal(mayStartDirectMessage({ recipientPolicy: "people_i_follow", senderAgeBand: "18_plus", recipientAgeBand: "13_17", recipientFollowsSender: true }).allowed, false);
  assert.equal(mayStartDirectMessage({ recipientPolicy: "people_i_follow", senderAgeBand: "18_plus", recipientAgeBand: "13_17", recipientFollowsSender: true, senderFollowsRecipient: true }).allowed, true);
});

test("unknown senders cannot start a conversation even when follows are mutual", () => {
  assert.deepEqual(mayStartDirectMessage({
    senderAgeBand: "unknown",
    recipientAgeBand: "18_plus",
    senderFollowsRecipient: true,
    recipientFollowsSender: true,
  }), { allowed: false, reason: "age_classification_required" });
});

test("unknown recipients get the mutual-follow boundary until they classify", () => {
  assert.equal(mayStartDirectMessage({
    senderAgeBand: "18_plus",
    recipientAgeBand: "unknown",
    recipientPolicy: "people_i_follow",
    recipientFollowsSender: true,
  }).allowed, false);
  assert.equal(mayStartDirectMessage({
    senderAgeBand: "18_plus",
    recipientAgeBand: "unknown",
    recipientPolicy: "people_i_follow",
    senderFollowsRecipient: true,
    recipientFollowsSender: true,
  }).allowed, true);
});

test("classification accepts only the two disclosed coarse bands", () => {
  assert.equal(isClassifiedAccountAgeBand("13_17"), true);
  assert.equal(isClassifiedAccountAgeBand("18_plus"), true);
  assert.equal(isClassifiedAccountAgeBand("unknown"), false);
  assert.equal(isClassifiedAccountAgeBand("adult"), false);
});
