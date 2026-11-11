import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import { createPageReturnController } from "./pageReturn.mjs";
const app = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
const nodes = [];
function visit(node) {
  if (!node || typeof node !== "object") return;
  if (node.type) nodes.push(node);
  for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value?.type) visit(value);
}
visit(parse(app, { sourceType: "module", plugins: ["jsx"] }));
const expression = node => app.slice(node.start, node.end);
const declaration = name => nodes.find(node => node.type === "VariableDeclarator" && node.id.name === name).init;
const opening = name => nodes.find(node => node.type === "JSXOpeningElement" && node.name.name === name);
const prop = (name, attribute) => opening(name).attributes.find(node => node.name?.name === attribute).value.expression;

test("native repeated detail routes retain separate page-return ownership while web keeps URL scopes", () => {
  const scope = new Function("overlay", "Platform", "nav", "session", "screenKey", "tabReturnScope", `return (${expression(declaration("pageReturnScope"))});`);
  const first = { profileId: "member" }, second = { profileId: "member" };
  const nativeScope = frame => scope(true, { OS: "ios" }, frame, { id: "viewer" }, "profile", "viewer|tab:feed");
  assert.equal(nativeScope(first), first); assert.notEqual(nativeScope(first), nativeScope(second));
  const controller = createPageReturnController(), calls = [];
  controller.register(first, () => calls.push("covered")); controller.register(second, () => calls.push("visible"));
  controller.activate(nativeScope(second));
  assert.equal(controller.request(first), false); controller.request(second); assert.deepEqual(calls, ["visible"]);
  const wrap = expression(prop("NativeDetailStack", "wrap"));
  assert.match(wrap, /PageReturnProvider controller=\{pageReturnRef.current\} scope=\{frame\}/);
  assert.equal(scope(false, { OS: "ios" }, first, null, "profile", "guest|tab:feed"), "guest|tab:feed");
  assert.equal(typeof scope(true, { OS: "web" }, first, { id: "viewer" }, "profile", "tab"), "string");
});

test("city selection intent stays keyed after Discover reports its selected programme", () => {
  const session = { id: "viewer" }; let destination = {}, selected;
  const setDestination = value => { destination = value; };
  const choose = new Function("session", "setDiscoverDestination", "switchTab", `return (${expression(prop("CityScreen", "onChooseCity"))});`)(session, setDestination, value => { selected = value; });
  choose(); assert.equal(destination.programme, "cities"); assert.equal(selected, "discover");
  const key = new Function("session", "discoverReturn", "pager", "discoverDestination", `return (${expression(prop("DiscoverScreen", "key"))});`);
  const before = key(session, null, false, destination);
  const remember = new Function("session", "setDiscoverDestination", "discoverDestination", `return (${expression(prop("DiscoverScreen", "onProgrammeChange"))});`)(session, setDestination, destination);
  remember("cities"); assert.equal(key(session, null, false, destination), before, "mount callback must not trigger a second remount and lose the city intent");
  const nativeLease = { key: "native-discover-lease" };
  assert.equal(key(session, nativeLease, false, destination), nativeLease.key);
});
