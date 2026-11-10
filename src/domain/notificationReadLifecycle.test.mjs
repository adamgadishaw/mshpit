import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import { captureAccountMutation, accountMutationIsCurrent } from "./accountMutation.mjs";
import * as notificationHelpers from "./notificationReadMutation.mjs";

const source = readFileSync(new URL("../store.js", import.meta.url), "utf8");
const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
function initializer(node, name) {
  if (node?.type === "VariableDeclarator" && node.id?.name === name) return node.init;
  if (!node || typeof node !== "object") return null;
  for (const value of Object.values(node)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      const found = initializer(item, name); if (found) return found;
    }
  }
  return null;
}
const row = (id, actorId = "peer") => ({ id, actorId, userId: "a", read: false, type: "follow" });
function fixture(initial = [row("existing")]) {
  let rows = initial;
  const pending = [], acknowledgements = [];
  const sessionRef = { current: { id: "a" } }, accountMutationEpochRef = { current: 1 };
  const blockedIdsRef = { current: [], mutedIds: [] };
  const dependencies = {
    ...notificationHelpers, captureAccountMutation, accountMutationIsCurrent,
    notifications: initial, session: sessionRef.current, sessionRef, accountMutationEpochRef, blockedIdsRef,
    loadNotificationHistory: (options) => notificationHelpers.fetchNotificationHistory(
      () => new Promise((resolve, reject) => pending.push({ resolve: (notifications) => resolve({ notifications }), reject })), options),
    acknowledgeNotificationBatch: (ids, options) => new Promise((resolve, reject) => acknowledgements.push({ ids, options, resolve, reject })),
    commandSuccess: (value) => ({ ok: true, ...value }),
    commandError: (error) => ({ ok: false, error }),
    localCommandError: (code) => ({ ok: false, error: { code } }),
    isLoadCancellation: (error, signal) => signal?.aborted || error?.name === "AbortError",
    setNotifications: (update) => { rows = update(rows); },
  };
  const bind = (name) => {
    const node = initializer(ast, name); assert.ok(node);
    return new Function(...Object.keys(dependencies), `return (${source.slice(node.start, node.end)});`)(...Object.values(dependencies));
  };
  return { refresh: bind("refreshNotifications"), markRead: bind("markNotificationsRead"), visible: bind("myNotifications"), pending, acknowledgements,
    sessionRef, accountMutationEpochRef, blockedIdsRef, rows: () => rows, replace: (next) => { rows = next; } };
}

for (const boundary of ["block", "mute"]) {
  test(`a delayed activity GET cannot restore an actor hidden by ${boundary}`, async () => {
    const f = fixture(), request = f.refresh();
    if (boundary === "block") f.blockedIdsRef.current = ["peer"];
    else f.blockedIdsRef.mutedIds = ["peer"];
    f.replace([]);
    f.pending[0].resolve([row("existing"), row("uncached"), row("allowed", "other")]);
    const result = await request;
    assert.deepEqual(f.rows().map(r => r.id), ["allowed"]);
    assert.deepEqual(result.map(r => r.id), ["allowed"], "acknowledgement input uses the same current boundary");
    assert.deepEqual(f.visible(), [], "existing rows hide immediately while the mutation is pending");
  });
}

test("an older history response cannot revive rows removed by a newer successful refresh", async () => {
  const f = fixture(), old = f.refresh(), fresh = f.refresh();
  f.pending[1].resolve([]); await fresh;
  f.pending[0].resolve([row("existing")]);
  assert.equal(await old, null);
  assert.deepEqual(f.rows(), []);
});

test("refresh privacy filtering leaves another account's retained history untouched", async () => {
  const foreign = { ...row("foreign"), userId: "b" };
  const f = fixture([row("existing"), foreign]);
  f.blockedIdsRef.current = ["peer"];
  const request = f.refresh();
  f.pending[0].resolve([row("existing")]);
  assert.deepEqual(await request, []);
  assert.deepEqual(f.rows(), [foreign]);
});

const confirm = (ids) => ({ ok: true, readContract: "notification-ids-v1", notificationIds: ids });
test("partial acknowledgement failure keeps remaining and concurrently arriving rows new, then retries safely", async () => {
  const original = Array.from({ length: 105 }, (_, i) => row(`n${i}`));
  const f = fixture(original), first = f.markRead();
  assert.equal(f.acknowledgements[0].ids.length, 100);
  f.replace([...original, row("concurrent")]);
  f.acknowledgements[0].resolve(confirm(f.acknowledgements[0].ids));
  await Promise.resolve();
  assert.equal(f.acknowledgements[1].ids.length, 5);
  f.acknowledgements[1].reject(new Error("connection lost after first batch"));
  assert.equal((await first).ok, false);
  assert.equal(f.rows().filter(r => r.read).length, 100);
  assert.equal(f.rows().find(r => r.id === "concurrent").read, false);
  const retry = f.markRead({ rows: f.rows().filter(r => r.id !== "concurrent") });
  assert.equal(f.acknowledgements[2].ids.length, 5);
  f.acknowledgements[2].resolve(confirm(f.acknowledgements[2].ids));
  assert.equal((await retry).ok, true);
  assert.equal(f.rows().filter(r => r.read).length, 105);
  assert.equal(f.rows().find(r => r.id === "concurrent").read, false);
});

test("a delayed acknowledgement cannot clear a new account or the reconnected original account", async () => {
  for (const roundTrip of [false, true]) {
    const f = fixture(), request = f.markRead();
    f.sessionRef.current = { id: "b" }; f.accountMutationEpochRef.current++;
    if (roundTrip) { f.sessionRef.current = { id: "a" }; f.accountMutationEpochRef.current++; }
    const current = [{ ...row("existing"), userId: f.sessionRef.current.id }];
    f.replace(current);
    f.acknowledgements[0].resolve(confirm(["existing"]));
    assert.equal((await request).ok, false);
    assert.deepEqual(f.rows(), current);
    assert.equal(f.rows()[0].read, false);
  }
});

test("account switch and same-account reconnect discard the delayed history", async () => {
  for (const roundTrip of [false, true]) {
    const f = fixture(), request = f.refresh();
    f.sessionRef.current = { id: "b" }; f.accountMutationEpochRef.current++;
    if (roundTrip) { f.sessionRef.current = { id: "a" }; f.accountMutationEpochRef.current++; }
    f.replace([]);
    f.pending[0].resolve([row("existing")]);
    assert.equal(await request, null); assert.deepEqual(f.rows(), []);
  }
});

test("failed history preserves unread rows and a subsequent reconnect can recover", async () => {
  const f = fixture(), failed = f.refresh();
  f.pending[0].reject(new Error("offline"));
  assert.equal(await failed, false); assert.equal(f.rows()[0].read, false);
  const retry = f.refresh(); f.pending[1].resolve([row("existing"), row("arrived")]);
  await retry;
  assert.deepEqual(f.rows().map(r => [r.id, r.read]), [["existing", false], ["arrived", false]]);
});
