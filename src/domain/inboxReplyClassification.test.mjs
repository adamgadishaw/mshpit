import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import { createAccountReadCoordinator } from "./accountReadCoordinator.mjs";
import { accountMutationIsCurrent, captureAccountMutation } from "./accountMutation.mjs";
import { chatDeliveryFailure, chatOutboxFor, confirmedChatMessage, updateChatOutboxItem, withoutChatOutboxItem } from "./chatDelivery.mjs";
import { mergeChatMessages, reconcileRemovedDirectMessages } from "./chatMessages.mjs";
import { directMessageUnreadCount, mergeDirectMessageReadSummary, normalizeDirectMessageReadCursor } from "./directMessageRead.mjs";
import { normalizeMessageRelationshipContext } from "./messageRelationshipContext.mjs";
import { applyDMRequestState, dmInboxBucket, normalizeDMRequestState } from "../features/chat/directMessageConsent.mjs";

const source = readFileSync(new URL("../store.js", import.meta.url), "utf8");
const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
const provider = ast.program.body.find(n => n.declaration?.id?.name === "StoreProvider").declaration;
const declarations = provider.body.body.flatMap(n => n.type === "VariableDeclaration" ? n.declarations : []);
const names = ["dmKey", "loadInboxThreads", "loadThread", "inboxThreads", "commitConfirmedChatMessage", "deliverChatMessage", "markThreadRead"];
const callbacks = names.map(name => {
  const node = declarations.find(n => n.id?.name === name);
  assert.ok(node, name);
  return `const ${source.slice(node.start, node.end)};`;
}).join("\n");
let hydrationNode;
function findHydration(node) {
  if (!node || typeof node !== "object") return;
  if (node.type === "CallExpression" && node.callee?.property?.name === "then"
    && node.callee.object?.callee?.name === "fetchDirectMessageSummaries") hydrationNode = node.arguments[0];
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(findHydration);
    else if (value && typeof value === "object") findHydration(value);
  }
}
findHydration(ast);
assert.ok(hydrationNode);
const hydrationCallback = source.slice(hydrationNode.start, hydrationNode.end);
const owner = { id: "A" }, peer = "peer", key = "A__peer";
const incoming = { id: "incoming", from: peer, text: "hello", createdAt: 50 };
const summary = hasReplied => ({ threads: [{ otherId: peer, messages: [incoming], readCursor: null, hasReplied }], removedIds: [] });

function fixture({ demo = false, queued = false } = {}) {
  const calls = [], following = new Set();
  const state = { dms: {}, dmRead: {}, users: [], outbox: [], blocked: [] };
  const sessionRef = { current: owner }, chatReadsRef = { current: createAccountReadCoordinator() };
  const chatOutboxRef = { current: state.outbox }, chatAuthEpochRef = { current: 1 }, accountMutationEpochRef = { current: 1 };
  const updates = [];
  const setter = field => update => {
    const apply = () => { state[field] = typeof update === "function" ? update(state[field]) : update; };
    if (queued) updates.push(apply); else apply();
  };
  const request = (...args) => new Promise((resolve, reject) => calls.push({ args, resolve, reject }));
  function dependencies() {
    return {
      session: sessionRef.current, sessionRef, chatReadsRef, chatOutboxRef, chatAuthEpochRef, accountMutationEpochRef,
      blockedIdsRef: { get current() { return state.blocked; } },
      dms: state.dms, dmRead: state.dmRead, chatOutbox: state.outbox, blockedIds: state.blocked,
      ENABLE_DEMO_DATA: demo, mergeChatMessages, reconcileRemovedDirectMessages, chatOutboxFor, confirmedChatMessage,
      updateChatOutboxItem, withoutChatOutboxItem, normalizeMessageRelationshipContext, chatDeliveryFailure, applyDMRequestState, dmInboxBucket, normalizeDMRequestState,
      directMessageUnreadCount, mergeDirectMessageReadSummary, normalizeDirectMessageReadCursor,
      captureAccountMutation, accountMutationIsCurrent,
      setDms: setter("dms"), setDmRead: setter("dmRead"), setUsers: setter("users"),
      absorbUsers: () => {}, publicProfileCacheEntry: user => user, ago: value => String(value),
      api: request, writeDirectMessageRead: request, currentMutationActor: () => sessionRef.current,
      isFollowing: id => following.has(id), userById: id => ({ id }),
      commitChatOutbox: update => { state.outbox = update(state.outbox); chatOutboxRef.current = state.outbox; },
      setFanClubMsgs: () => assert.fail("unexpected fan message"), setLounge: () => assert.fail("unexpected lounge message"),
      setNotifications: () => {}, reconcileConfirmedNotificationReads: rows => rows,
      commandSuccess: result => ({ ok: true, ...result }), commandError: error => ({ ok: false, error }),
      localCommandError: code => ({ ok: false, code }),
    };
  }
  function actions() {
    const deps = dependencies();
    return new Function(...Object.keys(deps), `${callbacks}\nreturn {${names.join(",")}};`)(...Object.values(deps));
  }
  function hydrate() {
    const deps = { ...dependencies(), su: sessionRef.current, dmKey: (a, b) => [a, b].sort().join("__"),
      dmHydrationRead: chatReadsRef.current.claim("dm-inbox", sessionRef.current) };
    return new Function(...Object.keys(deps), `return (${hydrationCallback});`)(...Object.values(deps));
  }
  const outbox = () => {
    state.outbox = [{ id: "pending", ownerId: "A", authEpoch: 1, kind: "dm", channelKey: key,
      from: "A", text: "reply", at: 60, pending: true, failed: false, status: "queued", endpoint: "/api/dms/peer" }];
    chatOutboxRef.current = state.outbox;
  };
  const adopt = id => {
    sessionRef.current = id ? { id } : null;
    chatReadsRef.current.reset(); chatAuthEpochRef.current++; accountMutationEpochRef.current++;
    state.dms = {}; state.dmRead = {}; state.outbox = []; chatOutboxRef.current = [];
  };
  return { state, calls, actions, hydrate, following, outbox, adopt,
    flush: () => { while (updates.length) updates.shift()(); } };
}

test("reply-only read records preserve explicit false, unknown legacy data and monotonic cursors", () => {
  assert.deepEqual(mergeDirectMessageReadSummary(undefined, { hasReplied: true }), { hasReplied: true });
  assert.deepEqual(mergeDirectMessageReadSummary({ hasReplied: true }, { hasReplied: false }), { hasReplied: false });
  assert.deepEqual(mergeDirectMessageReadSummary({ hasReplied: false }, { hasReplied: "true" }), { hasReplied: false });
  assert.equal(mergeDirectMessageReadSummary(2, {}), 2);
  for (const hasReplied of [true, false]) {
    assert.equal(mergeDirectMessageReadSummary(2, { readCursor: null, hasReplied }), 2);
  }
  assert.deepEqual(mergeDirectMessageReadSummary({ createdAt: 100, id: "new", hasReplied: true }, {
    readCursor: { createdAt: 10, id: "old" }, hasReplied: false,
  }), { createdAt: 100, id: "new", hasReplied: false });
});

test("startup hydration classifies a prior reply from only the latest incoming preview without a read cursor", () => {
  const f = fixture(); f.hydrate()(summary(true));
  assert.equal(f.state.dms[key].length, 1);
  assert.equal(f.state.dms[key][0].from, peer);
  assert.equal(f.actions().inboxThreads()[0].bucket, "main");
  assert.deepEqual(f.state.dmRead[key], { hasReplied: true });
});

test("legacy reply summary updates independently of durable confirmed-send acceptance", async () => {
  const f = fixture(); f.hydrate()(summary(true));
  f.state.dms[key].push({ id: "old-outgoing", from: "A", at: 1, server: true });
  const pending = f.actions().loadInboxThreads(); f.calls[0].resolve(summary(false)); await pending;
  assert.equal(f.state.dmRead[key].hasReplied, false);
  assert.equal(f.actions().inboxThreads()[0].bucket, "main");
  f.following.add(peer); assert.equal(f.actions().inboxThreads()[0].bucket, "main");
  f.following.clear(); assert.equal(f.actions().inboxThreads()[0].bucket, "main");
  f.state.blocked = [peer]; assert.deepEqual(f.actions().inboxThreads(), []);
});

test("requests and legacy fallback never treat pending, failed or unconfirmed outgoing rows as acceptance", () => {
  for (const proof of [false, undefined]) {
    const f = fixture(); f.hydrate()(summary(proof)); f.outbox();
    assert.equal(f.actions().inboxThreads()[0].bucket, "requests");
    f.state.outbox[0] = { ...f.state.outbox[0], pending: false, failed: true, status: "failed" };
    assert.equal(f.actions().inboxThreads()[0].bucket, "requests");
    f.state.outbox = []; f.state.dms[key].push({ id: "unconfirmed", from: "A", at: 60 });
    assert.equal(f.actions().inboxThreads()[0].bucket, "requests");
    f.state.dms[key].push({ id: "confirmed", from: "A", at: 70, server: true });
    assert.equal(f.actions().inboxThreads()[0].bucket, "main", "a confirmed send establishes durable consent independently of a legacy summary");
  }
});

test("confirmed retry promotes once and retires pre-send summaries; deletion cannot revoke consent", async () => {
  const f = fixture(); f.hydrate()(summary(false)); f.outbox();
  let send = f.actions().deliverChatMessage("pending"); f.calls[0].reject(new Error("offline"));
  assert.equal((await send).retryable, true);
  assert.equal(f.actions().inboxThreads()[0].bucket, "requests");
  const oldRead = f.actions().loadInboxThreads();
  send = f.actions().deliverChatMessage("pending"); f.calls[2].resolve({ id: "confirmed" });
  assert.equal((await send).ok, true);
  f.calls[1].resolve(summary(false)); await oldRead;
  assert.equal(f.actions().inboxThreads()[0].bucket, "main");
  assert.equal(f.state.dmRead[key].hasReplied, true);
  assert.equal(f.state.dms[key].filter(row => row.id === "confirmed").length, 1);
  const fresh = f.actions().loadInboxThreads(); f.calls[3].resolve({ ...summary(false), removedIds: ["confirmed"] }); await fresh;
  assert.equal(f.state.dmRead[key].hasReplied, false);
  assert.equal(f.actions().inboxThreads()[0].bucket, "main");
});

test("old summaries and send receipts cannot publish after logout, account switch or A-B-A", async () => {
  for (const transition of [null, "B", "A-B-A"]) {
    const f = fixture(); const hydrate = f.hydrate();
    const read = f.actions().loadInboxThreads(); f.outbox(); const sent = f.actions().deliverChatMessage("pending");
    f.adopt(transition === "A-B-A" ? "B" : transition); if (transition === "A-B-A") f.adopt("A");
    hydrate(summary(true)); f.calls[0].resolve(summary(true)); f.calls[1].resolve({ id: "late" });
    await read; assert.equal((await sent).stale, true);
    assert.deepEqual(f.state.dmRead, {}); assert.deepEqual(f.state.dms, {});
  }
});

test("latest inbox refresh wins and marking a conversation read retains its reply proof", async () => {
  const f = fixture(); f.hydrate()(summary(true));
  const older = f.actions().loadInboxThreads(), newer = f.actions().loadInboxThreads();
  f.calls[1].resolve(summary(false)); await newer; f.calls[0].resolve(summary(true)); await older;
  assert.equal(f.state.dmRead[key].hasReplied, false);
  const marked = f.actions().markThreadRead(peer, { messageId: "incoming" });
  f.calls[2].resolve({ ok: true, readCursor: { createdAt: 50, id: "incoming" }, notificationIds: [] });
  assert.equal((await marked).ok, true);
  assert.deepEqual(f.state.dmRead[key], { createdAt: 50, id: "incoming", hasReplied: false });
  const staleCursor = f.actions().loadInboxThreads();
  f.calls[3].resolve({ threads: [{ ...summary(true).threads[0], readCursor: { createdAt: 10, id: "old" } }] }); await staleCursor;
  assert.deepEqual(f.state.dmRead[key], { createdAt: 50, id: "incoming", hasReplied: true });
});


test("a confirmed demo reply preserves numeric read markers and does not resurrect unread messages", async () => {
  const f = fixture({ demo: true });
  f.state.dms[key] = [{ id: "first", from: peer, at: 1 }, { id: "second", from: peer, at: 2 }];
  f.state.dmRead[key] = 2; f.outbox();
  assert.equal(f.actions().inboxThreads()[0].unread, 0);
  assert.equal(f.actions().inboxThreads()[0].bucket, "requests");
  const sent = f.actions().deliverChatMessage("pending"); f.calls[0].resolve({ id: "confirmed-demo" });
  assert.equal((await sent).ok, true);
  assert.equal(f.state.dmRead[key], 2);
  assert.equal(f.actions().inboxThreads()[0].unread, 0);
  assert.equal(f.actions().inboxThreads()[0].bucket, "main");
});

test("authoritative consent state overrides a legacy reply-only summary", () => {
  for (const requestState of ["pending", "accepted"]) {
    const f = fixture();
    const payload = summary(requestState === "pending");
    payload.threads[0].requestState = requestState;
    f.hydrate()(payload);
    assert.equal(f.actions().inboxThreads()[0].bucket, requestState === "accepted" ? "main" : "requests");
  }
});

test("confirmed thread read queued before identity rotation cannot restore the previous read record", async () => {
  for (const transition of [null, "B", "A-B-A"]) {
    const f = fixture({ queued: true });
    const pending = f.actions().markThreadRead(peer, { messageId: "incoming" });
    f.calls[0].resolve({ ok: true, readCursor: { createdAt: 50, id: "incoming" }, notificationIds: [] });
    assert.equal((await pending).ok, true);
    f.adopt(transition === "A-B-A" ? "B" : transition);
    if (transition === "A-B-A") f.adopt("A");
    f.flush();
    assert.deepEqual(f.state.dmRead, {});
  }
});

const countedSummary = (unread, latest = 1200, readCursor = null) => ({
  threads: [{ ...summary(true).threads[0], unread, latestIncomingCursor: { createdAt: latest, id: `m${latest}` }, readCursor,
    messages: [{ id: `m${latest}`, from: peer, text: "preview", createdAt: latest }] }], removedIds: [],
});

test("Store preserves full unread counts through hydration, head load, outgoing preview and cold hydration", async () => {
  const f = fixture(); f.hydrate()(countedSummary(1200));
  assert.equal(f.actions().inboxThreads()[0].unread, 1200);
  const head = f.actions().loadThread(peer);
  f.calls[0].resolve({ ...countedSummary(1200).threads[0], messages: Array.from({ length: 500 }, (_, i) => ({ id: `m${701 + i}`, from: peer, createdAt: 701 + i })) });
  await head;
  assert.equal(f.actions().inboxThreads()[0].count, 500);
  assert.equal(f.actions().inboxThreads()[0].unread, 1200);
  const cold = fixture(), payload = countedSummary(1200);
  payload.threads[0].messages = [{ id: "reply", from: "A", text: "outgoing", createdAt: 1201 }];
  cold.hydrate()(payload);
  assert.equal(cold.actions().inboxThreads()[0].count, 1);
  assert.equal(cold.actions().inboxThreads()[0].unread, 1200);
});

test("overlapping Inbox and head reads preserve the newer authoritative total", async () => {
  const f = fixture(); f.hydrate()(countedSummary(1200));
  const inbox = f.actions().loadInboxThreads(), head = f.actions().loadThread(peer);
  f.calls[1].resolve({ ...countedSummary(1203, 1203).threads[0], messages: [{ id: "m1203", from: peer, createdAt: 1203 }] });
  await head;
  f.calls[0].resolve(countedSummary(1200)); await inbox;
  assert.equal(f.actions().inboxThreads()[0].unread, 1203);
});

test("read receipt targets an explicit observed message and stale summaries cannot resurrect its total", async () => {
  const f = fixture(); f.hydrate()(countedSummary(1200));
  const inbox = f.actions().loadInboxThreads();
  const controller = new AbortController();
  const read = f.actions().markThreadRead(peer, { messageId: "m1000", signal: controller.signal });
  assert.deepEqual(f.calls[1].args, [peer, { messageId: "m1000", signal: controller.signal, expectedAccountId: "A" }]);
  f.calls[1].resolve({ ok: true, ...countedSummary(200, 1200, { createdAt: 1000, id: "m1000" }).threads[0], notificationIds: [] });
  assert.equal((await read).ok, true);
  f.calls[0].resolve(countedSummary(1200)); await inbox;
  assert.equal(f.actions().inboxThreads()[0].unread, 200);
});

test("read receipts require a target, reject blocked/aborted entry and ignore completion after abort", async () => {
  const f = fixture(); f.hydrate()(countedSummary(1200));
  assert.equal((await f.actions().markThreadRead(peer)).ok, false);
  f.state.blocked = [peer];
  assert.equal((await f.actions().markThreadRead(peer, { messageId: "m1200" })).ok, false);
  f.state.blocked = [];
  const controller = new AbortController(); controller.abort();
  assert.equal((await f.actions().markThreadRead(peer, { messageId: "m1200", signal: controller.signal })).ok, false);
  assert.equal(f.calls.length, 0);
  const live = new AbortController();
  const pending = f.actions().markThreadRead(peer, { messageId: "m1200", signal: live.signal });
  live.abort();
  f.calls[0].resolve({ ok: true, readCursor: { createdAt: 1200, id: "m1200" }, unread: 0, latestIncomingCursor: { createdAt: 1200, id: "m1200" } });
  assert.equal((await pending).ok, false);
  assert.equal(f.actions().inboxThreads()[0].unread, 1200);
});

test("a blocked peer or retired account cannot publish a confirmed unread snapshot in queued state", async () => {
  for (const transition of ["block", null, "B", "A-B-A"]) {
    const f = fixture({ queued: true }); f.hydrate()(countedSummary(1200)); f.flush();
    const pending = f.actions().markThreadRead(peer, { messageId: "m1200" });
    f.calls[0].resolve({ ok: true, readCursor: { createdAt: 1200, id: "m1200" }, unread: 0, latestIncomingCursor: { createdAt: 1200, id: "m1200" } });
    assert.equal((await pending).ok, true);
    if (transition === "block") f.state.blocked = [peer];
    else { f.adopt(transition === "A-B-A" ? "B" : transition); if (transition === "A-B-A") f.adopt("A"); }
    f.flush();
    if (transition === "block") assert.equal(f.state.dmRead[key].unread, 1200);
    else assert.deepEqual(f.state.dmRead, {});
  }
});

test("route eligibility fences receipt entry, completion and queued state publication", async () => {
  for (const timing of ["entry", "response", "queued"]) {
    const f = fixture({ queued: timing === "queued" }); f.hydrate()(countedSummary(1200)); f.flush();
    let current = timing !== "entry";
    const pending = f.actions().markThreadRead(peer, { messageId: "m1200", isCurrent: () => current });
    if (timing === "entry") { assert.equal((await pending).ok, false); assert.equal(f.calls.length, 0); continue; }
    if (timing === "response") current = false;
    f.calls[0].resolve({ ok: true, readCursor: { createdAt: 1200, id: "m1200" }, unread: 0, latestIncomingCursor: { createdAt: 1200, id: "m1200" } });
    assert.equal((await pending).ok, timing === "queued");
    current = false; f.flush();
    assert.equal(f.state.dmRead[key].unread, 1200);
  }
});

test("Inbox counts do not resurrect a removed cached newest row when its tombstone is missing", async () => {
  const f = fixture(); f.hydrate()(countedSummary(1200));
  const refresh = f.actions().loadInboxThreads();
  f.calls[0].resolve(countedSummary(1199, 1199)); await refresh;
  assert.equal(f.actions().inboxThreads()[0].count, 2, "fixture deliberately retains old preview without a tombstone");
  assert.equal(f.actions().inboxThreads()[0].unread, 1199);
});
