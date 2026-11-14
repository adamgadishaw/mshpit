import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createIOSCommentDrafts, unavailableCommentDraft } from "./iosCommentDrafts.mjs";
const setup = options => { const owner = createIOSCommentDrafts(options); owner.account("A", 1); return owner; };
test("bounded lease retains only allowed scalar fields, no caller reply snapshot", () => {
  const owner = setup(), lease = owner.lease("post"); lease.edit("x".repeat(1100)); lease.reply("parent");
  assert.equal(lease.read().text.length, 1000);
  assert.deepEqual(Object.keys(lease.read()).sort(), ["text", "parentId", "invalidReply", "revision", "sending", "retry", "error"].sort());
  assert.equal(owner.lease("other").read().text, ""); assert.equal(owner.lease("post"), lease);
});
test("malformed reply IDs cannot silently become top-level", () => {
  for (const value of [undefined, {}, [], 1, "", " parent ", "x".repeat(201)]) {
    const lease = setup().lease("post"); lease.edit("hello"); lease.reply(value);
    assert.equal(lease.read().invalidReply, true); assert.equal(lease.claim(true), null);
    lease.reply(null); assert.equal(lease.claim(false).intent.parentId, null);
  }
});
test("new reply validation differs from exact attempted retry, no automatic delivery", () => {
  const lease = setup().lease("post"); lease.edit(" hello "); lease.reply("parent");
  assert.equal(lease.claim(false), null); const claim = lease.claim(true);
  assert.equal(lease.claim(true), null); lease.settle(claim, { ok: false });
  lease.edit("new"); lease.reply("other"); assert.equal(lease.claim(false), null); const retry = lease.claim(true);
  assert.equal(retry.intent, claim.intent); assert.equal(retry.intent.text, "hello"); assert.equal(retry.intent.parentId, "parent");
  lease.settle(retry, { ok: true }); assert.equal(lease.read().text, "new"); assert.equal(lease.read().parentId, "other");
  assert.equal(lease.claim(false), null);
});
test("unchanged success clears; changed-back revision and stale settlements cannot clear newer input", () => {
  const lease = setup().lease("post"); lease.edit("one"); const first = lease.claim(false);
  lease.edit("two"); lease.edit("one"); lease.settle(first, { ok: true }); assert.equal(lease.read().text, "one");
  const next = lease.claim(false); assert.notEqual(next.intent.clientMutationId, first.intent.clientMutationId);
  lease.settle(first, { ok: false }); assert.equal(lease.read().sending, true);
  lease.settle(next, { ok: true }); assert.equal(lease.read().text, ""); assert.equal(lease.read().parentId, null);
});
test("A B A and auth epoch changes erase old leases and fence pending settlements", () => {
  for (const transition of [o => { o.account("B", 1); o.account("A", 1); }, o => o.account("A", 2), o => { o.account(null, 2); o.account("A", 3); }]) {
    const owner = setup(), old = owner.lease("post"); old.edit("secret"); const claim = old.claim(false);
    transition(owner); const fresh = owner.lease("post"); fresh.edit("fresh");
    old.edit("late"); old.reply("parent"); old.settle(claim, { ok: true });
    assert.equal(old.read().text, ""); assert.equal(old.claim(false), null); assert.equal(fresh.read().text, "fresh");
  }
});
test("capacity never evicts pending, unresolved failed intent or subscribed composer; admission recovers", () => {
  let available = 0; const owner = setup({ capacity: 2, onAvailable: () => available++ });
  const first = owner.lease("one"); first.edit("one"); const claim = first.claim(false);
  const second = owner.lease("two"), unsubscribe = second.subscribe(() => {}); second.edit("two");
  assert.equal(owner.lease("three"), unavailableCommentDraft);
  first.settle(claim, { ok: false }); assert.equal(owner.lease("three"), unavailableCommentDraft);
  unsubscribe(); const admitted = owner.lease("three"); assert.notEqual(admitted, unavailableCommentDraft);
  assert.equal(second.read().text, ""); assert.ok(available > 0);
  assert.equal(owner.lease("one").read().retry, true);
});
test("Root uses account+auth epoch and iOS-only platform resolution without importing owner into other bundles", () => {
  const app = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
  assert.match(app, /commentDraftsRef.current.account\(session\?\.id \|\| null, chatAuthEpoch\)/);
  assert.match(app, /commentDraft=\{Platform.OS === "ios" \? commentDraftsRef.current.lease\(nav.post.id\) : null\}/);
  const fallback = readFileSync(new URL("./commentDraftOwner.js", import.meta.url), "utf8");
  assert.doesNotMatch(fallback, /import|iosCommentDrafts/);
  const ios = readFileSync(new URL("./commentDraftOwner.ios.js", import.meta.url), "utf8"); assert.match(ios, /iosCommentDrafts.mjs/);
});

test("explicit discard releases a failed slot but cannot release pending or stale claims", () => {
  const owner = setup({ capacity: 1 }), lease = owner.lease("post"); lease.edit("hello");
  const claim = lease.claim(false); lease.discardAttempt(lease.failedAttempt()); assert.equal(lease.read().sending, true);
  lease.settle(claim, { ok: false }); assert.equal(owner.lease("other"), unavailableCommentDraft);
  lease.discardAttempt(lease.failedAttempt()); assert.equal(lease.read().text, "hello");
  assert.notEqual(owner.lease("other"), unavailableCommentDraft);
  lease.discardAttempt(lease.failedAttempt()); assert.equal(lease.read().text, "");
});

test("discard confirmation belongs to exactly one failed intent, never a newer attempt", () => {
  const lease = setup().lease("post"); lease.edit("first"); const first = lease.claim(false); lease.settle(first, { ok: false });
  const confirmed = lease.failedAttempt(); lease.discardAttempt(confirmed);
  lease.edit("second"); const second = lease.claim(false); lease.discardAttempt(confirmed); assert.equal(lease.read().sending, true);
  lease.settle(second, { ok: false }); lease.discardAttempt(confirmed); assert.equal(lease.read().retry, true);
  assert.equal(lease.failedAttempt(), second.intent);
});
