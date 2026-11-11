import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import { createAccountReadCoordinator } from "./accountReadCoordinator.mjs";
import { accountMutationIsCurrent, captureAccountMutation } from "./accountMutation.mjs";
import { chatOutboxFor, confirmedChatMessage, updateChatOutboxItem, withoutChatOutboxItem } from "./chatDelivery.mjs";
import { mergeChatMessages, reconcileRemovedDirectMessages } from "./chatMessages.mjs";
import { directMessageUnreadCount, mergeDirectMessageReadSummary, normalizeDirectMessageReadCursor } from "./directMessageRead.mjs";
import { normalizeMessageRelationshipContext } from "./messageRelationshipContext.mjs";


const source = readFileSync(new URL("../store.js", import.meta.url), "utf8");
const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
const provider = ast.program.body.find(n => n.declaration?.id?.name === "StoreProvider").declaration;
const declarations = provider.body.body.flatMap(n => n.type === "VariableDeclaration" ? n.declarations : []);
const names = ["dmKey", "loadInboxThreads", "loadThread", "inboxThreads", "markThreadRead"];
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
  const state = { dms: {}, dmRead: {}, users: [], outbox: [], blocked: [], notifications: [] };
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
      updateChatOutboxItem, withoutChatOutboxItem, normalizeMessageRelationshipContext,
      directMessageUnreadCount, mergeDirectMessageReadSummary, normalizeDirectMessageReadCursor,
      captureAccountMutation, accountMutationIsCurrent,
      setDms: setter("dms"), setDmRead: setter("dmRead"), setUsers: setter("users"),
      absorbUsers: () => {}, publicProfileCacheEntry: user => user, ago: value => String(value),
      api: request, writeDirectMessageRead: request, currentMutationActor: () => sessionRef.current,
      isFollowing: id => following.has(id), userById: id => ({ id }),
      commitChatOutbox: update => { state.outbox = update(state.outbox); chatOutboxRef.current = state.outbox; },
      setFanClubMsgs: () => assert.fail("unexpected fan message"), setLounge: () => assert.fail("unexpected lounge message"),
      setNotifications: setter("notifications"), reconcileConfirmedNotificationReads: rows => [...rows, { id: "confirmed" }],
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

test("queued startup and inbox state cannot cross logout or account A-B-A", async () => {
  for (const lane of ["hydrate", "inbox", "thread"]) {
    const f = fixture({ queued: true });
    const payload = { ...summary(true), unread: 1200, latestIncomingCursor: { createdAt: 50, id: incoming.id } };
    payload.threads[0] = { ...payload.threads[0], unread: 1200, latestIncomingCursor: payload.latestIncomingCursor, requestState: "accepted" };
    if (lane === "hydrate") f.hydrate()(payload);
    else { const work = lane === "inbox" ? f.actions().loadInboxThreads() : f.actions().loadThread(peer);
      f.calls[0].resolve(lane === "inbox" ? payload : { messages: [incoming], ...payload }); await work; }
    f.adopt("B"); f.adopt("A"); f.flush();
    assert.deepEqual(f.state.dms, {}); assert.deepEqual(f.state.dmRead, {}); assert.deepEqual(f.state.users, []);
  }
});

test("a later-issued thread count wins over delayed startup and Inbox snapshots", async () => {
  const f = fixture(); const hydrate = f.hydrate();
  const inbox = f.actions().loadInboxThreads(); const thread = f.actions().loadThread(peer);
  f.calls[1].resolve({ messages: [incoming], readCursor: null, unread: 1201,
    latestIncomingCursor: { createdAt: 60, id: "newer" }, requestState: "accepted" }); await thread;
  const older = { ...summary(true), threads: [{ ...summary(true).threads[0], unread: 1200, latestIncomingCursor: { createdAt: 50, id: incoming.id } }] };
  f.calls[0].resolve(older); await inbox; hydrate(older);
  assert.equal(f.actions().inboxThreads()[0].unread, 1201);
  assert.equal(f.actions().inboxThreads()[0].bucket, "main");
});

test("server acceptance survives removed replies while unconfirmed sends do not accept a request", () => {
  const f = fixture();
  f.hydrate()({ threads: [{ ...summary(false).threads[0], requestState: "accepted", unread: 8, latestIncomingCursor: { createdAt: 50, id: incoming.id } }] });
  assert.equal(f.actions().inboxThreads()[0].bucket, "main");
  assert.equal(f.actions().inboxThreads()[0].unread, 8);
  const pending = fixture(); pending.hydrate()(summary(false)); pending.outbox();
  assert.equal(pending.actions().inboxThreads()[0].bucket, "requests");
});

test("canceled or covered receipts cannot publish queued read and notification state", async () => {
  const f = fixture({ queued: true }); const controller = new AbortController(); let current = true;
  const receipt = f.actions().markThreadRead(peer, { messageId: "seen", signal: controller.signal, isCurrent: () => current });
  f.calls[0].resolve({ ok: true, readCursor: { createdAt: 50, id: "seen" }, unread: 0, latestIncomingCursor: { createdAt: 50, id: "seen" }, notificationIds: [] });
  assert.equal((await receipt).ok, true); current = false; controller.abort(); f.flush();
  assert.deepEqual(f.state.dmRead, {}); assert.deepEqual(f.state.notifications, []);
});
