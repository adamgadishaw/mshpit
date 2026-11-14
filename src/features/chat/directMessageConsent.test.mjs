import assert from "node:assert/strict";
import test from "node:test";
import { applyDMRequestState, dmInboxBucket, dmRequestState } from "./directMessageConsent.mjs";
import { mergeChatMessages } from "../../domain/chatMessages.mjs";

test("authoritative acceptance survives summary-only hydration and trimmed replies", () => {
  const old = [{ id: "old-reply", from: "viewer", server: true, at: 1 }];
  const incoming = Array.from({ length: 800 }, (_, i) => ({ id: `in-${i}`, from: "peer", server: true, at: i + 2 }));
  const rows = applyDMRequestState(mergeChatMessages(old, incoming, [], 750), "viewer", "accepted");
  assert.equal(rows.length, 750);
  assert.ok(rows.every(row => row.from === "peer"));
  assert.equal(dmInboxBucket({ messages: rows, accountId: "viewer" }), "main");
  assert.equal(dmRequestState(applyDMRequestState(incoming.slice(-1), "viewer", "accepted"), "viewer"), "accepted");
});

test("late pending snapshots cannot undo confirmed acceptance", () => {
  const rows = applyDMRequestState([{ id: "in", from: "peer", server: true }], "viewer", "pending");
  const accepted = applyDMRequestState(rows, "viewer", "accepted");
  assert.equal(dmRequestState(applyDMRequestState(accepted, "viewer", "pending"), "viewer"), "accepted");
  assert.equal(dmRequestState(accepted, "different-account"), null, "private viewer metadata is not portable to another account");
});

test("pending and failed authored messages do not accept requests", () => {
  const pending = applyDMRequestState([{ id: "received", from: "peer", server: true }], "viewer", "pending");
  for (const extra of [
    { id: "queued", from: "viewer", pending: true },
    { id: "failed", from: "viewer", failed: true },
    { id: "bad-confirmation", from: "viewer", server: true, failed: true },
  ]) assert.equal(dmInboxBucket({ messages: [...pending, extra], accountId: "viewer" }), "requests");
  assert.equal(dmRequestState([...pending, { id: "confirmed", from: "viewer", server: true }], "viewer"), "accepted");
});

test("older servers keep conservative follow compatibility without accepting strangers", () => {
  const rows = [{ id: "received", from: "peer", server: true }];
  assert.equal(dmRequestState(rows, "viewer"), null);
  assert.equal(dmInboxBucket({ messages: rows, accountId: "viewer" }), "requests");
  assert.equal(dmInboxBucket({ messages: rows, accountId: "viewer", following: true }), "main");
  assert.equal(dmRequestState(applyDMRequestState(rows, "viewer", "untrusted-state"), "viewer"), null);
});

test("demo compatibility cannot treat queued or failed sends as consent", () => {
  for (const flags of [{ pending: true }, { failed: true }, { pending: true, server: true }]) {
    assert.equal(dmInboxBucket({ messages: [{ from: "viewer", ...flags }], accountId: "viewer", demo: true }), "requests");
  }
  assert.equal(dmInboxBucket({ messages: [{ from: "viewer" }], accountId: "viewer", demo: true }), "main");
});
