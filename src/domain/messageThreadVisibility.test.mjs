import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";

const source = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
function find(node, predicate) {
  if (!node || typeof node !== "object") return null;
  if (predicate(node)) return node;
  for (const value of Object.values(node)) {
    for (const child of Array.isArray(value) ? value : [value]) {
      const found = find(child, predicate); if (found) return found;
    }
  }
  return null;
}
const visibility = find(ast, node => node.type === "AssignmentExpression" && node.left.object?.name === "threadReadVisibleRef").right;
const guard = find(ast, node => node.type === "VariableDeclarator" && node.id.name === "isCurrentMessageThread").init;
const thread = find(ast, node => node.type === "JSXOpeningElement" && node.name.name === "ThreadScreen");
assert.equal(thread.attributes.find(node => node.name?.name === "isCurrentIOSRoute").value.expression.name, "isCurrentMessageThread");
function fixture(overrides = {}) {
  const flags = { appActive: true, authReady: true, session: { id: "me" }, accountStatus: () => "ok", iosMenuOpen: false,
    acctOpen: false, welcome: false, nativeAccountLinkActive: false, nativeAccountLinkActiveRef: { current: false }, authLinkError: false,
    resetToken: null, unsubToken: null, verifyToken: null, ownerApprovalToken: null, verificationPrompt: null, publicNavigationNotice: null,
    newsStoryNotice: null, ...overrides };
  const visible = new Function(...Object.keys(flags), `return (${source.slice(visibility.start, visibility.end)});`)(...Object.values(flags));
  const nav = { thread: "peer" }, current = { current: visible }, navigation = { current: { stack: [nav] } }, scope = {};
  let owns = true;
  const deps = { threadReadVisibleRef: current, nav, navigationRef: navigation, linkedNavigationScope: scope,
    linkedNavigationRef: { current: { ownsScope: candidate => owns && candidate === scope } }, Platform: { OS: "ios" } };
  const eligible = new Function(...Object.keys(deps), `return (${source.slice(guard.start, guard.end)});`)(...Object.values(deps));
  return { eligible, current, navigation, retire: () => { owns = false; } };
}

test("message read eligibility excludes covering menus, account flows, notices and inactive accounts", () => {
  assert.equal(fixture().eligible(), true);
  for (const field of ["iosMenuOpen", "acctOpen", "welcome", "nativeAccountLinkActive", "authLinkError", "resetToken", "unsubToken", "verifyToken", "ownerApprovalToken", "verificationPrompt", "publicNavigationNotice", "newsStoryNotice"]) {
    assert.equal(fixture({ [field]: true }).eligible(), false, field);
  }
  assert.equal(fixture({ nativeAccountLinkActiveRef: { current: true } }).eligible(), false);
  assert.equal(fixture({ appActive: false }).eligible(), false);
  assert.equal(fixture({ authReady: false }).eligible(), false);
  assert.equal(fixture({ accountStatus: () => "suspended" }).eligible(), false);
});

test("previously captured read guards observe overlay, route and account retirement immediately", () => {
  const f = fixture(), guard = f.eligible;
  f.current.current = false; assert.equal(guard(), false);
  f.current.current = true; assert.equal(guard(), true);
  f.navigation.current.stack.push({ profile: "other" }); assert.equal(guard(), false);
  f.navigation.current.stack.pop(); assert.equal(guard(), true);
  f.retire(); assert.equal(guard(), false);
});
