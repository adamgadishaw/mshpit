import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import { staffScopeFor } from "../domain/staffReadCoordinator.mjs";

const source = readFileSync(new URL("./AdminScreen.jsx", import.meta.url), "utf8");
const component = parse(source, { sourceType: "module", plugins: ["jsx"] }).program.body.find((node) => node.type === "ExportDefaultDeclaration").declaration;
const declarations = component.body.body.flatMap((node) => node.type === "VariableDeclaration" ? node.declarations : []);
const callbacks = ["loadErrorLog", "sendTestAlert"].map((name) => {
  const declaration = declarations.find((node) => node.id.name === name);
  assert.ok(declaration, name);
  return `const ${source.slice(declaration.start, declaration.end)};`;
}).join("\n");
const refreshTask = declarations.find((node) => node.init?.callee?.name === "useScopedRefresh")
  .init.arguments[0].properties.find((node) => node.key.name === "task").value;
const overviewBranch = refreshTask.body.body.find((node) => node.type === "IfStatement"
  && node.test.left?.name === "activeTab" && node.test.right?.value === "overview");
assert.ok(overviewBranch);
const refreshCallback = `const refreshOverview = async ({ signal }) => ${source.slice(overviewBranch.consequent.start, overviewBranch.consequent.end)};`;
const ownershipStart = source.indexOf("  const errorScope =");
const ownershipEnd = source.indexOf("  const memorialAdmin =", ownershipStart);
assert.ok(ownershipStart >= 0 && ownershipEnd > ownershipStart);
const renderOwnership = new Function("iAmAdmin", "artistRequestScope", "errorLogOwner", "errorLogState", `${source.slice(ownershipStart, ownershipEnd)}\nreturn { diagnosticsOwner, errorLog };`);

function fixture() {
  const errorLogOwner = { current: { scope: null } };
  let errorLogState = { owner: null, data: null }, session = { id: "owner-a", role: "admin" };
  const calls = [], effects = [], captured = [];
  const activeStaffSession = { current: session };
  let failOverview = false;
  const setErrorLogState = (next) => { effects.push(next); errorLogState = typeof next === "function" ? next(errorLogState) : next; };
  const request = (kind, options) => new Promise((resolve, reject) => calls.push({ kind, options, resolve, reject }));
  const render = (next = session) => {
    session = next;
    activeStaffSession.current = session;
    const owned = renderOwnership(session?.role === "admin", staffScopeFor(session), errorLogOwner, errorLogState);
    const dependencies = { ...owned, errorLogOwner, setErrorLogState, readAdminErrors: (options) => request("read", options),
      sendAdminErrorTestAlert: () => request("test"), captureAppError: (...args) => captured.push(args),
      staffScopeFor, activeStaffSession, artistRequestScope: staffScopeFor(session), setHealth() {},
      loadModerationConsole: async () => { if (failOverview) throw new Error("overview failed"); return {}; },
      loadAdminMembersStrict: async () => [], readAdminHealth: async () => ({}) };
    return { ...owned, ...new Function(...Object.keys(dependencies), `${callbacks}\n${refreshCallback}\nreturn { loadErrorLog, sendTestAlert, refreshOverview };`)(...Object.values(dependencies)) };
  };
  return { render, calls, effects, captured, state: () => errorLogState, owner: errorLogOwner, failOverview() { failOverview = true; } };
}
const owner = { id: "owner-a", role: "admin" }, other = { id: "owner-b", role: "admin" };

test("diagnostics render immediately hides prior account data and reloads for another admin", async () => {
  const f = fixture(), initial = f.render(), first = initial.loadErrorLog();
  f.calls[0].resolve({ errors: [{ detail: { reason: "owner-only detail" } }] });
  await first;
  assert.ok(f.render().errorLog);
  const switched = f.render(other);
  assert.equal(switched.errorLog, null);
  await initial.loadErrorLog();
  assert.equal(f.calls.length, 1, "old rendered control cannot dispatch");
  const second = switched.loadErrorLog();
  f.calls[1].resolve({ errors: [] });
  await second;
  assert.deepEqual(f.render().errorLog, { errors: [] });
});

test("old read completion cannot cross logout, role loss, account switch or A-B-A", async () => {
  for (const transitions of [[null], [{ ...owner, role: "moderator" }], [other], [other, owner], [{ ...owner, role: "moderator" }, owner]]) {
    const f = fixture(), initial = f.render(), pending = initial.loadErrorLog();
    for (const session of transitions) f.render(session);
    const before = f.effects.length;
    f.calls[0].resolve({ errors: [{ detail: { reason: "must not leak" } }] });
    await pending;
    assert.equal(f.effects.length, before);
    assert.equal(f.render().errorLog, null);
  }
});

test("aborted and superseded diagnostics never replace newer results or show stale errors", async () => {
  const f = fixture(), initial = f.render(), old = initial.loadErrorLog();
  const next = initial.loadErrorLog();
  f.calls[1].resolve({ errors: [], marker: "new" });
  await next;
  f.calls[0].reject(new Error("old request failed"));
  await old;
  assert.equal(f.render().errorLog.marker, "new");
  assert.equal(f.captured.length, 0);
  const controller = new AbortController();
  const pending = initial.loadErrorLog({ signal: controller.signal });
  controller.abort();
  const before = f.effects.length;
  f.calls[2].resolve({ marker: "aborted" });
  await pending;
  assert.equal(f.effects.length, before);
});

test("read failure is recoverable and does not fabricate an empty successful window", async () => {
  const f = fixture(), initial = f.render(), pending = initial.loadErrorLog();
  f.calls[0].reject(new Error("offline"));
  await pending;
  assert.equal(f.state().data, null);
  assert.equal(f.state().loading, false);
  assert.match(f.state().error, /could not be loaded/);
  const retried = initial.loadErrorLog();
  f.calls[1].resolve({ serious24h: { occurrences: 0, kinds: 0 } });
  await retried;
  assert.equal(f.state().error, "");
  assert.equal(f.render().errorLog.serious24h.occurrences, 0);
});

test("a stale test-alert control and response cannot repopulate another account's diagnostics", async () => {
  const f = fixture(), initial = f.render(), load = initial.loadErrorLog();
  f.calls[0].resolve({ errors: [] });
  await load;
  const loaded = f.render(), pending = loaded.sendTestAlert();
  f.render(other);
  const before = f.effects.length;
  f.calls[1].resolve({ sent: true });
  await pending;
  assert.equal(f.effects.length, before);
  await loaded.sendTestAlert();
  assert.equal(f.calls.length, 2);
  assert.equal(f.render().errorLog, null);
});

test("failed overview refresh superseding initial load stops the spinner and supports retry", async () => {
  const f = fixture(), initial = f.render(), first = initial.loadErrorLog();
  f.failOverview();
  await assert.rejects(initial.refreshOverview({ signal: new AbortController().signal }), /overview failed/);
  assert.equal(f.state().loading, false);
  assert.match(f.state().error, /Retry loading site errors/);
  f.calls[0].resolve({ marker: "old" });
  f.calls[1].resolve({ marker: "failed refresh" });
  await first;
  assert.equal(f.render().errorLog, null);
  const retry = f.render().loadErrorLog();
  f.calls[2].resolve({ marker: "recovered" });
  await retry;
  assert.equal(f.render().errorLog.marker, "recovered");
  assert.equal(f.state().error, "");
});

test("overview refresh failure cannot write through an account transition", async () => {
  const f = fixture(), initial = f.render();
  f.failOverview();
  const pending = initial.refreshOverview({ signal: new AbortController().signal });
  f.render(other);
  f.render(owner);
  const before = f.effects.length;
  await assert.rejects(pending, /overview failed/);
  f.calls[0].resolve({ marker: "old" });
  assert.equal(f.effects.length, before);
  assert.equal(f.render().errorLog, null);
});
