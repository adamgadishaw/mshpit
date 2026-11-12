import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createIOSMessageDrafts, unavailableMessageDraft } from "./iosMessageDrafts.mjs";
const fixture = (options) => { const owner = createIOSMessageDrafts(options); owner.account("A", 1); return owner; };
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
// Models Thread's external-store mount and send handler; promises outlive mounts.
function mount(owner, recipient, deliver = async () => ({ ok: true })) {
  const lease = owner.lease(recipient);
  let snapshot = lease.read();
  const unmount = lease.subscribe(() => { snapshot = lease.read(); });
  return { lease, unmount, read: () => snapshot, edit: lease.edit,
    async send() {
      const claim = lease.claim();
      if (!claim) return;
      try { lease.settle(claim, await deliver(claim.text)); }
      catch { lease.settle(claim, { ok: false }); }
    },
  };
}

test("unsent DM survives profile navigation and Back without delivery", () => {
  const owner = fixture(); let calls = 0;
  const first = mount(owner, "friend", () => { calls++; }); first.edit("See you at the show"); first.unmount();
  const back = mount(owner, "friend");
  assert.equal(back.read().text, "See you at the show"); assert.equal(calls, 0);
  back.edit(""); back.unmount(); assert.equal(mount(owner, "friend").read().text, "");
});
test("claim survives unmount; Back before resolution and double-submit cannot duplicate", async () => {
  const owner = fixture(), request = deferred(); let calls = 0;
  const deliver = () => { calls++; return request.promise; };
  const first = mount(owner, "friend", deliver); first.edit("hello");
  const sending = first.send(); void first.send(); first.unmount();
  const back = mount(owner, "friend", deliver);
  assert.equal(back.read().sending, true); await back.send(); assert.equal(calls, 1);
  request.resolve({ ok: true }); await sending;
  assert.deepEqual(back.read(), { text: "", sending: false });
});
test("matching success clears, newer edits including changed-back same text survive", async () => {
  for (const newer of ["newer message", "original"]) {
    const owner = fixture(), request = deferred(), first = mount(owner, "friend", () => request.promise);
    first.edit("original"); const sending = first.send(); first.unmount();
    const back = mount(owner, "friend"); back.edit("temporary edit"); back.edit(newer);
    request.resolve({ ok: true }); await sending;
    assert.deepEqual(back.read(), { text: newer, sending: false });
  }
});
test("late failure releases claim, keeps text and performs no retry or requeue", async () => {
  const owner = fixture(), request = deferred(); let calls = 0;
  const first = mount(owner, "friend", () => { calls++; return request.promise; });
  first.edit("hello"); const sending = first.send(); first.unmount();
  const back = mount(owner, "friend"); request.resolve({ ok: false }); await sending;
  assert.deepEqual(back.read(), { text: "hello", sending: false }); assert.equal(calls, 1);
});
test("thrown send also releases the claim without clearing edits", async () => {
  const first = mount(fixture(), "friend", async () => { throw new Error("offline"); });
  first.edit("hello"); await first.send(); assert.deepEqual(first.read(), { text: "hello", sending: false });
});
test("recipient isolation and late completion while a different thread is open", () => {
  const owner = fixture(), a = owner.lease("one"); a.edit("one"); const claim = a.claim();
  const b = owner.lease("two"); b.edit("two"); a.settle(claim, { ok: true });
  assert.equal(b.read().text, "two"); assert.equal(owner.lease("one").read().text, "");
});
test("A to B to A, logout and same-ID reauth fence stale edits and settlements", () => {
  for (const transition of [(o) => { o.account("B", 1); o.account("A", 1); }, (o) => { o.account(null, 2); o.account("A", 3); }, (o) => o.account("A", 2)]) {
    const owner = fixture(), old = owner.lease("friend"); old.edit("secret"); const claim = old.claim();
    transition(owner); const current = owner.lease("friend"); current.edit("fresh");
    old.edit("late edit"); old.settle(claim, { ok: true });
    assert.equal(old.read().text, ""); assert.deepEqual(current.read(), { text: "fresh", sending: false });
  }
});
test("routine same-account render retains state; later deliberate same-text sends are allowed", () => {
  const owner = fixture(), draft = owner.lease("friend"); draft.edit("hello"); const first = draft.claim();
  owner.account("A", 1); assert.equal(owner.lease("friend"), draft);
  draft.settle(first, { ok: true }); draft.edit("hello"); const second = draft.claim();
  assert.ok(second); assert.notEqual(second, first);
  draft.settle(first, { ok: true }); assert.equal(draft.read().sending, true);
  draft.settle(second, { ok: true }); assert.equal(draft.read().text, "");
});
test("explicit clear while sending does not release claim or resurrect submitted text", () => {
  const draft = fixture().lease("friend"); draft.edit("hello"); const claim = draft.claim(); draft.edit("");
  assert.equal(draft.read().sending, true); assert.equal(draft.claim(), null);
  draft.settle(claim, { ok: false }); assert.deepEqual(draft.read(), { text: "", sending: false });
});
test("bounded cache never evicts pending entries; capacity recovers explicitly on settlement", () => {
  let available = 0;
  const owner = fixture({ capacity: 2, onAvailable: () => available++ });
  const first = owner.lease("one"); first.edit("one"); const claim = first.claim();
  const second = owner.lease("two"); second.edit("two"); second.claim();
  assert.equal(owner.lease("three"), unavailableMessageDraft); assert.equal(first.read().sending, true);
  first.settle(claim, { ok: true }); assert.equal(available, 1);
  const third = owner.lease("three"); assert.notEqual(third, unavailableMessageDraft); third.edit("three");
  first.edit("stale"); assert.equal(third.read().text, "three"); assert.equal(second.read().sending, true);
});
test("last idle unsubscribe admits a waiting route once without evicting pending sends", () => {
  let available = 0;
  const owner = fixture({ capacity: 2, onAvailable: () => available++ });
  const pending = mount(owner, "pending"); pending.edit("still sending"); const claim = pending.lease.claim();
  const idle = mount(owner, "idle"); idle.edit("draft");
  const extraUnsubscribe = idle.lease.subscribe(() => {});
  assert.equal(owner.lease("next"), unavailableMessageDraft);
  pending.unmount(); assert.equal(available, 0);
  idle.unmount(); assert.equal(available, 0);
  extraUnsubscribe(); assert.equal(available, 1);
  extraUnsubscribe(); idle.unmount(); assert.equal(available, 1);
  const next = owner.lease("next"); assert.notEqual(next, unavailableMessageDraft);
  assert.equal(pending.lease.read().sending, true);
  assert.equal(pending.lease.claim(), null);
  pending.lease.settle(claim, { ok: true });
  assert.equal(pending.lease.read().text, "");
});
test("stale account unsubscribe and non-full cache cleanup do not notify availability", () => {
  let available = 0;
  const owner = fixture({ capacity: 2, onAvailable: () => available++ });
  const first = mount(owner, "one"); first.unmount(); assert.equal(available, 0);
  const stale = mount(owner, "two"); owner.account("B", 2);
  owner.lease("one"); owner.lease("two"); stale.unmount(); assert.equal(available, 0);
});
test("drafts bound text and LRU inactive recipients, not active subscribed entries", () => {
  const owner = fixture({ capacity: 2 }), active = mount(owner, "one"); active.edit("x".repeat(1200));
  const other = owner.lease("two"); other.edit("old"); owner.lease("three");
  assert.equal(active.read().text.length, 1000); assert.equal(other.read().text, "");
});
test("successful outbox retry clears only matching unchanged composer, never newer edits", () => {
  const draft = fixture().lease("friend"); draft.edit(" hello "); const before = draft.read();
  draft.clearMatching(before, "hello"); assert.equal(draft.read().text, "");
  draft.edit("hello"); const old = draft.read(); draft.edit("new"); draft.edit("hello");
  draft.clearMatching(old, "hello"); assert.equal(draft.read().text, "hello");
});
test("App owns only iOS leases and Thread retains legacy non-iOS path", () => {
  const app = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
  const thread = readFileSync(new URL("../screens/ThreadScreen.jsx", import.meta.url), "utf8");
  assert.match(app, /messageDraftsRef\.current\.account\(session\?\.id \|\| null, chatAuthEpoch\)/);
  assert.match(app, /draftLease=\{Platform\.OS === "ios" \? messageDraftsRef\.current\.lease\(nav.thread\) : null\}/);
  assert.match(thread, /const iosDraft = Platform.OS === "ios" \? draftLease : null/);
  assert.match(thread, /useSyncExternalStore\(/); assert.match(thread, /const claim = iosDraft.claim\(\)/);
  assert.match(thread, /iosDraft.settle\(claim, result\)/);
  assert.match(app, /if \(messageDraftsMountedRef.current\) refreshDraftCapacity/);
  assert.match(app, /messageDraftsMountedRef.current = true;[\s\S]*return \(\) => \{ messageDraftsMountedRef.current = false; \}/);
  assert.match(thread, /const submitted = text;[\s\S]*updateComposer\(\{ sending: true \}\)/);
});
