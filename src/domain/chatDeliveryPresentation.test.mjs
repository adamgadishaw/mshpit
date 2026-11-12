import assert from "node:assert/strict";
import test from "node:test";
import { chatDeliveryPresentation, chatDeliverySnippetPrefix } from "./chatDeliveryPresentation.mjs";

test("lost acknowledgement never claims the message was not sent or retracted", () => {
  const state = chatDeliveryPresentation({ failed: true, deliveryState: "unconfirmed", retryable: true });
  assert.equal(state.label, "Not confirmed");
  assert.match(state.detail, /may already have arrived/);
  assert.match(state.dismissHint, /does not delete/);
  assert.equal(chatDeliverySnippetPrefix({ failed: true, deliveryState: "unconfirmed" }), "Not confirmed: ");
});

test("definite and authentication failures do not offer a forbidden retry", () => {
  for (const deliveryState of ["rejected", "auth_required"]) {
    assert.equal(chatDeliveryPresentation({ failed: true, deliveryState, retryable: false }).retryable, false);
  }
  assert.equal(chatDeliveryPresentation({ failed: true, deliveryState: "retry_later" }).label, "Try again later");
});

test("legacy recovery remains available and confirmed rows carry no failure prefix", () => {
  assert.equal(chatDeliveryPresentation({ failed: true }).retryable, true);
  assert.equal(chatDeliveryPresentation({ failed: true }).dismissLabel, "Cancel failed message");
  assert.equal(chatDeliverySnippetPrefix({ text: "Hello", failed: false }), "");
});

// A later auth failure cannot disprove an earlier server commit.
test("authentication failure preserves uncertain delivery and local dismissal", () => {
  const state = chatDeliveryPresentation({ failed: true, deliveryState: "auth_required", deliveryUncertain: true, retryable: false });
  assert.equal(state.label, "Sign in to send");
  assert.equal(state.dismissText, "dismiss");
  assert.match(state.dismissHint, /does not delete/);
  assert.match(state.detail, /may already have arrived/);
});
