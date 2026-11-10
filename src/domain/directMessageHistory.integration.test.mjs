import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import { createAccountReadCoordinator } from "./accountReadCoordinator.mjs";
import { mergeChatMessages } from "./chatMessages.mjs";
import { applyDMRequestState, dmRequestState, normalizeDMRequestState } from "../features/chat/directMessageConsent.mjs";
import { createDirectMessageHistory, isMessageHistoryAccessError } from "./directMessageHistory.mjs";

function functionSource(path, name) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
  const visit = (node) => {
    if (!node || typeof node !== "object") return null;
    if (node.type === "VariableDeclarator" && node.id?.name === name) return node.init;
    for (const child of Object.values(node)) {
      for (const value of Array.isArray(child) ? child : [child]) {
        const found = visit(value); if (found) return found;
      }
    }
    return null;
  };
  const node = visit(ast); assert.ok(node, name);
  return source.slice(node.start, node.end);
}
const storeLoad = functionSource("../store.js", "loadThread");
const screenLoad = functionSource("../screens/ThreadScreen.jsx", "loadThreadPage");
const bind = (source, bindings) => new Function(...Object.keys(bindings), `return (${source});`)(...Object.values(bindings));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const messages = (start, end) => Array.from({ length: end - start + 1 }, (_, index) => {
  const createdAt = start + index;
  return { id: `m${String(createdAt).padStart(4, "0")}`, createdAt, from: "peer", text: `Message ${createdAt}` };
});
function fixture() {
  let dms = {};
  const calls = [], sessionRef = { current: { id: "me" } }, chatReadsRef = { current: createAccountReadCoordinator() };
  const loadThread = bind(storeLoad, {
    chatReadsRef, sessionRef, dmKey: (a, b) => [a, b].sort().join("__"),
    api: (path, options) => { const response = deferred(); calls.push({ path, options, ...response }); return response.promise; },
    normalizeMessageRelationshipContext: (value) => value, ago: (at) => String(at),
    mergeChatMessages, applyDMRequestState, normalizeDMRequestState, setDms: (update) => { dms = update(dms); }, URLSearchParams,
  });
  const history = createDirectMessageHistory(), activeHistory = { current: history };
  const loadPage = bind(screenLoad, { historyBlocked: false, activeHistory, history, loadThread, otherId: "peer", isMessageHistoryAccessError });
  return { loadThread, loadPage, history, calls, sessionRef, chatReadsRef, activeHistory, current: () => dms.me__peer || [] };
}

test("actual Store and screen page bridge retain1000 rows while the live cache stays bounded", async () => {
  const f = fixture();
  const initial = f.loadPage({ strict: true });
  f.calls[0].resolve({ messages: messages(501, 1000), nextCursor: "before501", syncCursor: "live1000" });
  await initial;
  assert.equal(f.current().length, 500);
  const earlier = f.history.loadEarlier({ load: (options) => f.loadThread("peer", options) });
  await Promise.resolve();
  assert.match(f.calls[1].path, /before=before501/);
  assert.match(f.calls[1].path, /context=0/);
  const live = f.loadPage({ after: "live1000", strict: true });
  f.calls[2].resolve({ messages: messages(1001, 1300), syncCursor: "live1300", hasMore: false });
  await live;
  f.calls[1].resolve({ messages: messages(1, 500), nextCursor: null, syncCursor: null, hasMore: false });
  await earlier;
  assert.equal(f.current().length, 750);
  assert.equal(f.history.display(f.current()).length, 1300);
  assert.equal(f.history.display(f.current())[0].id, "m0001");
});

test("a simultaneous older request cannot stale the current poll or overwrite its cursor", async () => {
  const f = fixture();
  const live = f.loadThread("peer", { after: "live", strict: true });
  const earlier = f.loadThread("peer", { before: "older", strict: true });
  f.calls[1].resolve({ messages: messages(1, 3), nextCursor: "next-older", syncCursor: null });
  const oldResult = await earlier;
  f.calls[0].resolve({ messages: messages(4, 6), syncCursor: "new-live" });
  const liveResult = await live;
  assert.equal(oldResult.nextCursor, "next-older");
  assert.equal(liveResult.syncCursor, "new-live");
  assert.equal(liveResult.stale, undefined);
  assert.deepEqual(f.current().map((row) => row.id), ["m0004", "m0005", "m0006"]);
});

test("account rotation rejects an ignored-abort older page before it reaches the screen owner", async () => {
  const f = fixture();
  const request = f.loadThread("peer", { before: "older", strict: true });
  f.chatReadsRef.current.reset(); f.sessionRef.current = { id: "new-account" };
  f.calls[0].resolve({ messages: messages(1, 3), nextCursor: null });
  const result = await request;
  assert.equal(result.stale, true);
  assert.equal(result.messages, undefined);
  assert.deepEqual(f.current(), []);
});

test("actual permission failure clears the recent Store cache and hides the screen history", async () => {
  const f = fixture();
  const initial = f.loadPage({ strict: true });
  f.calls[0].resolve({ messages: messages(1, 3), nextCursor: null }); await initial;
  const denied = f.loadPage({ after: "live", strict: false });
  const rejected = assert.rejects(denied, { status: 403 });
  f.calls[1].reject(Object.assign(new Error("unavailable"), { status: 403 })); await rejected;
  assert.deepEqual(f.current(), []);
  assert.deepEqual(f.history.display([]), []);
  const recovery = f.loadPage({ after: "old-live", strict: true });
  assert.doesNotMatch(f.calls[2].path, /after=/, "recovery rechecks an authorized head instead of reusing a hidden cursor");
  f.calls[2].resolve({ messages: messages(1, 4), nextCursor: null }); await recovery;
  assert.equal(f.history.display(f.current()).length, 4);
});

test("replaced screen owner cannot absorb a late authorized response", async () => {
  const f = fixture(), request = f.loadPage({ strict: true });
  f.activeHistory.current = createDirectMessageHistory();
  f.calls[0].resolve({ messages: messages(1, 3), nextCursor: null }); await request;
  assert.deepEqual(f.history.read().messages, []);
});

test("before and after cannot be mixed and invalid responses preserve the retry boundary", async () => {
  const f = fixture();
  await assert.rejects(f.loadThread("peer", { before: "old", after: "new" }));
  assert.equal(f.calls.length, 0);
  const request = f.loadThread("peer", { before: "old", strict: true });
  const rejected = assert.rejects(request);
  f.calls[0].resolve({ nextCursor: null }); await rejected;
  assert.deepEqual(f.current(), []);
});

test("history paging preserves authoritative acceptance in the recent cache", async () => {
  const f = fixture();
  const head = f.loadPage({ strict: true });
  f.calls[0].resolve({ messages: messages(501, 1000), nextCursor: "older", requestState: "accepted" });
  const headResult = await head;
  assert.equal(headResult.requestState, "accepted");
  const earlier = f.loadThread("peer", { before: "older", strict: true });
  f.calls[1].resolve({ messages: messages(1, 500), nextCursor: null, requestState: "pending" });
  await earlier;
  assert.equal(f.current().length, 500);
  assert.equal(dmRequestState(f.current(), "me"), "accepted");
  const live = f.loadPage({ after: "live", strict: true });
  f.calls[2].resolve({ messages: messages(1001, 1300), requestState: "pending" });
  await live;
  assert.equal(f.current().length, 750);
  assert.equal(dmRequestState(f.current(), "me"), "accepted");
});
