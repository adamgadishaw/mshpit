import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parse } from "@babel/parser";
import { createAccountReadCoordinator } from "./accountReadCoordinator.mjs";
import { accountMutationIsCurrent, captureAccountMutation } from "./accountMutation.mjs";
import { mergeChatMessages, reconcileRemovedDirectMessages } from "./chatMessages.mjs";
import { applyDMRequestState, dmRequestState, normalizeDMRequestState } from "../features/chat/directMessageConsent.mjs";

const source = readFileSync(new URL("../store.js", import.meta.url), "utf8");
const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
function find(node, predicate) {
  if (!node || typeof node !== "object") return null;
  if (predicate(node)) return node;
  for (const child of Object.values(node)) {
    for (const value of Array.isArray(child) ? child : [child]) {
      const found = find(value, predicate); if (found) return found;
    }
  }
  return null;
}
const bind = (node, bindings) => new Function(...Object.keys(bindings), `return (${source.slice(node.start, node.end)});`)(...Object.values(bindings));
const implementation = name => find(ast, node => node.type === "VariableDeclarator" && node.id?.name === name).init;
const hydration = find(ast, node => node.type === "CallExpression" && node.callee?.property?.name === "then"
  && node.callee.object?.callee?.name === "fetchDirectMessageSummaries").arguments[0];
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const row = (id, from = "peer") => ({ id, from, at: 1, server: true });
const accepted = () => applyDMRequestState([row("old")], "me", "accepted");
const thread = (requestState = "pending") => ({ otherId: "peer", requestState, messages: [{ id: "new", from: "peer", createdAt: 2 }] });

function fixture({ queued = false, rows = accepted() } = {}) {
  let dms = { me__peer: rows }, dmRead = {}, users = [];
  const updates = [], calls = [], writes = [];
  const sessionRef = { current: { id: "me" } }, chatReadsRef = { current: createAccountReadCoordinator() };
  const accountMutationEpochRef = { current: 1 }, blockedIdsRef = { current: [] };
  const update = callback => queued ? updates.push(callback) : callback();
  const bindings = {
    sessionRef, chatReadsRef, accountMutationEpochRef, blockedIdsRef,
    dmKey: (a, b) => [a, b].sort().join("__"),
    api: (path, options) => { const response = deferred(); calls.push({ path, options, ...response }); return response.promise; },
    writeDMRequestAcceptance: () => { const response = deferred(); writes.push(response); return response.promise; },
    currentMutationActor: () => sessionRef.current,
    captureAccountMutation, accountMutationIsCurrent,
    localCommandError: code => ({ ok: false, code }), commandError: error => ({ ok: false, error }),
    commandSuccess: value => ({ ok: true, ...value }), ENABLE_DEMO_DATA: false,
    normalizeMessageRelationshipContext: value => value, ago: String,
    mergeChatMessages, reconcileRemovedDirectMessages, applyDMRequestState, normalizeDMRequestState,
    normalizeDirectMessageReadCursor: value => value,
    latestDirectMessageReadCursor: (old, next) => next || old,
    publicProfileCacheEntry: value => value,
    setDms: updater => update(() => { dms = updater(dms); }),
    setDmRead: updater => update(() => { dmRead = updater(dmRead); }),
    setUsers: updater => update(() => { users = updater(users); }),
  };
  bindings.absorbUsers = bind(implementation("absorbUsers"), bindings);
  return {
    loadThread: bind(implementation("loadThread"), bindings),
    loadInbox: bind(implementation("loadInboxThreads"), bindings),
    accept: bind(implementation("acceptDMRequest"), bindings),
    hydrate() {
      const ticket = chatReadsRef.current.claim("dm-inbox", sessionRef.current);
      return bind(hydration, { ...bindings, dmHydrationRead: ticket, su: { id: "me" } });
    },
    calls, writes, updates, sessionRef, chatReadsRef, accountMutationEpochRef, blockedIdsRef,
    flush() { while (updates.length) updates.shift()(); },
    state: () => ({ dms, dmRead, users }),
  };
}

for (const lane of ["thread", "inbox", "hydration"]) {
  test(`${lane} preserves acceptance when a response removes every previously accepted row`, async () => {
    const f = fixture();
    if (lane === "hydration") f.hydrate()({ threads: [thread()], removedIds: ["old"] });
    else {
      const pending = lane === "thread" ? f.loadThread("peer") : f.loadInbox();
      f.calls[0].resolve(lane === "thread"
        ? { messages: thread().messages, requestState: "pending", removedIds: ["old"] }
        : { threads: [thread()], removedIds: ["old"] });
      await pending;
    }
    const rows = f.state().dms.me__peer;
    assert.deepEqual(rows.map(item => item.id), ["new"]);
    assert.equal(dmRequestState(rows, "me"), "accepted");
  });
}

test("confirmed acceptance invalidates inbox, live and historical reads but preserves other threads", async () => {
  const f = fixture({ rows: [row("old")] });
  const inbox = f.loadInbox(), live = f.loadThread("peer"), history = f.loadThread("peer", { before: "older" });
  const unrelated = f.loadThread("other");
  const accept = f.accept("peer");
  f.writes[0].resolve({ ok: true, requestState: "accepted" });
  assert.equal((await accept).ok, true);
  f.calls[0].resolve({ threads: [thread()], removedIds: ["old"] });
  for (const request of f.calls.slice(1)) request.resolve({ messages: thread().messages, requestState: "pending", removedIds: ["old"] });
  assert.deepEqual(await inbox, []);
  assert.equal((await live).stale, true);
  assert.equal((await history).stale, true);
  assert.equal((await unrelated).stale, undefined);
  assert.equal(dmRequestState(f.state().dms.me__peer, "me"), "accepted");
});

for (const lane of ["thread", "inbox", "hydration"]) {
  test(`${lane} rechecks read ownership when React commits queued state`, async () => {
    const f = fixture({ queued: true });
    const response = { threads: [{ ...thread(), otherUser: { id: "peer" }, readCursor: { id: "new", at: 2 } }], removedIds: ["old"] };
    if (lane === "hydration") f.hydrate()(response);
    else {
      const pending = lane === "thread" ? f.loadThread("peer") : f.loadInbox();
      f.calls[0].resolve(lane === "thread" ? { messages: thread().messages, removedIds: ["old"] } : response);
      await pending;
    }
    f.chatReadsRef.current.reset();
    f.sessionRef.current = { id: "replacement" };
    f.flush();
    assert.deepEqual(f.state(), { dms: { me__peer: accepted() }, dmRead: {}, users: [] });
  });
}

test("a queued request-acceptance completion cannot cross an account epoch or later block", async () => {
  for (const retire of [f => { f.accountMutationEpochRef.current += 1; }, f => { f.blockedIdsRef.current = ["peer"]; }]) {
    const f = fixture({ queued: true, rows: [row("old")] });
    const pending = f.accept("peer");
    f.writes[0].resolve({ ok: true, requestState: "accepted" });
    await pending;
    retire(f); f.flush();
    assert.equal(dmRequestState(f.state().dms.me__peer, "me"), null);
  }
});

test("inbox profile absorption honors cancellation after the response queued its updater", async () => {
  const f = fixture({ queued: true }), controller = new AbortController();
  const pending = f.loadInbox({ signal: controller.signal });
  f.calls[0].resolve({ threads: [{ ...thread(), otherUser: { id: "peer", handle: "old-profile" } }] });
  await pending;
  controller.abort(); f.flush();
  assert.deepEqual(f.state(), { dms: { me__peer: accepted() }, dmRead: {}, users: [] });
});

test("a superseded denial cannot erase a newer authorized thread or reach its history owner", async () => {
  const f = fixture();
  const old = f.loadThread("peer", { strict: true });
  const current = f.loadThread("peer", { strict: true });
  f.calls[1].resolve({ messages: thread().messages, requestState: "accepted" }); await current;
  f.calls[0].reject(Object.assign(new Error("outdated denial"), { status: 403 }));
  assert.equal((await old).stale, true);
  assert.equal(f.state().dms.me__peer.at(-1).id, "new");
});

test("a queued denial cannot clear a thread after a newer read takes ownership", async () => {
  const f = fixture({ queued: true });
  const denied = f.loadThread("peer", { strict: true });
  const rejection = assert.rejects(denied, { status: 403 });
  f.calls[0].reject(Object.assign(new Error("denied"), { status: 403 })); await rejection;
  const newer = f.loadThread("peer");
  f.flush();
  assert.deepEqual(f.state().dms.me__peer, accepted());
  f.calls[1].resolve({ messages: thread().messages }); await newer; f.flush();
});
