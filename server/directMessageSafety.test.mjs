import test from "node:test";
import assert from "node:assert/strict";
import { isClassifiedAccountAgeBand, mayStartDirectMessage } from "./directMessageSafety.js";

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
