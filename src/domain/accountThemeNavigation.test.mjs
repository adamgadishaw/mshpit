import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { parse } from "@babel/parser";
import { accountThemeNavigationReady } from "./accountThemeNavigation.mjs";

test("account themes wait for authoritative identity and settled navigation", () => {
  const confirmed = { authReady: true, accountId: "member", frame: {} };
  assert.equal(accountThemeNavigationReady(confirmed), true);
  for (const patch of [
    { authReady: false }, { accountId: null }, { frame: { auth: true } },
    { frame: { auth: true, authMode: "signup" } },
    { frame: { routeLoading: "/post/p" } }, { sensitiveFlow: true },
  ]) assert.equal(accountThemeNavigationReady({ ...confirmed, ...patch }), false);
  assert.equal(accountThemeNavigationReady({ ...confirmed, frame: { post: { id: "p" } } }), true);
});

function findNode(source, matches) {
  let found;
  const visit = node => {
    if (!node || typeof node !== "object") return;
    if (matches(node)) { assert.equal(found, undefined); found = node; }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  };
  visit(parse(source, { sourceType: "module", plugins: ["jsx"] }).program);
  assert.ok(found);
  return found;
}

test("actual Root theme effect reads the live destination rather than a stale render frame", () => {
  const source = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
  const node = findNode(source, node => node.type === "CallExpression" && node.callee.name === "useEffect"
    && source.slice(node.arguments[0]?.start, node.arguments[0]?.end).includes("accountThemeNavigationReady"));
  const scope = {
    authReady: true, session: { id: "member" }, resetToken: null, ownerApprovalToken: null,
    navigationRef: { current: { stack: [{}, { auth: true }] } },
    accountThemeSyncRef: { current: null },
    accountThemeNavigationReady, calls: 0,
  };
  scope.syncAccountTheme = () => { scope.calls++; };
  const effect = runInNewContext(`(${source.slice(node.arguments[0].start, node.arguments[0].end)})`, scope);
  effect(); assert.equal(scope.calls, 0, "history Back has not committed yet");
  scope.navigationRef.current.stack = [{}, { routeLoading: "/post/p" }];
  effect(); assert.equal(scope.calls, 0, "fresh public content must settle before a reload");
  scope.navigationRef.current.stack = [{}, { post: { id: "p" } }];
  effect(); assert.equal(scope.calls, 1);
  scope.navigationRef.current.stack = [{}, { venueName: "A different public destination" }];
  effect(); assert.equal(scope.calls, 1, "ordinary navigation must not repeat a preference write");
  scope.authReady = false;
  effect(); assert.equal(scope.calls, 1, "identity revalidation must not trigger appearance work");
});

test("actual Store theme reconciliation binds the current confirmed account", () => {
  const source = readFileSync(new URL("../store.js", import.meta.url), "utf8");
  const node = findNode(source, node => node.type === "VariableDeclarator" && node.id.name === "syncAccountTheme");
  const calls = [];
  let stored = { theme: "stage", ownerId: "old-member" };
  const scope = {
    sessionRef: { current: { id: "member", theme: "daylight" } }, authReadyRef: { current: false },
    storedThemeSelection: () => stored,
    syncThemeFromAccount: (...args) => calls.push(["apply", ...args]),
    api: (...args) => { calls.push(["request", ...args]); return Promise.resolve({}); },
  };
  const sync = runInNewContext(`(${source.slice(node.init.start, node.init.end)})`, scope);
  sync(); assert.deepEqual(calls, []);
  scope.authReadyRef.current = true;
  sync(); assert.deepEqual(calls, [["apply", "daylight", "member"]]);
  calls.length = 0;
  stored = { theme: "forest", ownerId: "member" };
  sync(); assert.equal(calls[0][2].expectedAccountId, "member");
  assert.equal(calls[0][2].body.theme, "forest");
  calls.length = 0;
  scope.sessionRef.current = { id: "second-member", theme: "stage" };
  sync(); assert.deepEqual(calls, [["apply", "stage", "second-member"]], "a stored choice never crosses account ownership");
  calls.length = 0;
  scope.sessionRef.current = null;
  sync(); assert.deepEqual(calls, []);
});
