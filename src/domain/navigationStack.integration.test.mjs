import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { parse } from "@babel/parser";
import { replaceNavigationFrame } from "./navigationStack.mjs";

const source = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
const syntax = parse(source, { sourceType: "module", plugins: ["jsx"] });
const names = ["runAfterComposerClose", "commitGo", "commitReplace", "popStack", "requestComposerPop", "back", "onPop"];
const declarations = new Map();
function visit(node) {
  if (!node || typeof node !== "object") return;
  if (node.type === "VariableDeclarator" && names.includes(node.id?.name)) {
    assert.equal(declarations.has(node.id.name), false, `ambiguous App binding: ${node.id.name}`);
    declarations.set(node.id.name, `const ${node.id.name} = ${source.slice(node.init.start, node.init.end)};`);
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") visit(value);
  }
}
visit(syntax.program);
for (const name of names) assert.ok(declarations.has(name), `missing App navigation binding: ${name}`);
const actualFunctions = `(() => { ${names.map((name) => declarations.get(name)).join("\n")} return { ${names.join(", ")} }; })()`;
const snapshot = (value) => JSON.parse(JSON.stringify(value));

// Execute the actual App callbacks, not a copy of their stack/history policy.
// State writes queue until flush(), like a React render boundary. History Back
// invokes App's real popstate callback, including the composer close guard.
function appNavigation(initialStack = [{}], { web = true, prepare = (frame) => frame } = {}) {
  let state = initialStack;
  const queued = [];
  const calls = [];
  let cursor = initialStack.length - 1;
  const entries = initialStack.map((frame, index) => ({ state: { pit: index ? "nav" : "base" }, url: frame.path || "/" }));
  const stackRef = { current: state };
  let functions;
  const history = {
    pushState(value, title, url) {
      calls.push({ method: "pushState", value, url });
      entries.splice(cursor + 1);
      entries.push({ state: value, url: url || entries[cursor].url });
      cursor++;
    },
    replaceState(value, title, url) {
      calls.push({ method: "replaceState", value, url });
      entries[cursor] = { state: value, url: url || entries[cursor].url };
    },
    back() {
      calls.push({ method: "back" });
      if (cursor > 0) { cursor--; functions.onPop(); }
    },
  };
  const guardRef = { current: null };
  functions = runInNewContext(actualFunctions, {
    web, stackRef, replaceNavigationFrame, prepareAvailableNavigationFrame: prepare,
    pathForFrame: (frame) => frame.path || null,
    setStack: (update) => queued.push(update), window: { history },
    composerCloseGuardRef: guardRef, bypassNextPopRef: { current: null },
    sessionRef: { current: { id: "navigation-fixture" } }, setLanding: () => {},
  });
  return {
    ...functions, calls, entries, stackRef, guardRef,
    get cursor() { return cursor; },
    get state() { return snapshot(state); },
    flush() {
      while (queued.length) {
        const update = queued.shift();
        state = typeof update === "function" ? update(state) : update;
      }
      stackRef.current = state;
    },
  };
}

test("App root replacement pushes browser history and its real Back reaches tabs", () => {
  const app = appNavigation();
  app.commitReplace({ nearby: true, nearbyTab: "shows" });
  assert.deepEqual(app.state, [{}], "React has not committed the queued render yet");
  assert.equal(app.stackRef.current.length, 2, "history callbacks immediately observe root growth");
  assert.deepEqual(app.calls.map((call) => call.method), ["pushState"]);
  assert.equal(app.cursor, 1);
  app.back();
  app.flush();
  assert.deepEqual(app.state, [{}]);
  assert.equal(app.cursor, 0);
  assert.deepEqual(app.calls.map((call) => call.method), ["pushState", "back"]);
});

test("App lateral replacement preserves prior stack and replaces only the browser's top entry", () => {
  const artist = { artistName: "Fixture Band", path: "/artist/fixture" };
  const app = appNavigation([{}, artist, { menu: true }]);
  app.commitReplace({ settings: true });
  app.flush();
  assert.deepEqual(app.state, [{}, artist, { settings: true }]);
  assert.equal(app.entries.length, 3);
  assert.deepEqual(app.calls.map((call) => call.method), ["replaceState"]);
  app.back();
  app.flush();
  assert.deepEqual(app.state, [{}, artist]);
  assert.equal(app.cursor, 1);
  assert.equal(app.entries[app.cursor].url, "/artist/fixture");
});

test("two App replacements before a render push once and then replace the current destination", () => {
  const app = appNavigation();
  app.commitReplace({ nearby: true });
  app.commitReplace({ pickArtists: true });
  assert.deepEqual(app.calls.map((call) => call.method), ["pushState", "replaceState"]);
  assert.equal(app.entries.length, 2);
  app.flush();
  assert.deepEqual(app.state, [{}, { pickArtists: true }]);
  app.back();
  app.flush();
  assert.deepEqual(app.state, [{}]);
});

test("App push then lateral replacement mirrors public URLs without adding an extra Back step", () => {
  const app = appNavigation();
  app.commitGo({ artistName: "Fixture Band", path: "/artist/fixture" });
  app.flush();
  app.commitReplace({ profileId: "fixture", path: "/u/fixture" });
  app.flush();
  assert.deepEqual(app.calls.map((call) => call.method), ["pushState", "replaceState"]);
  assert.equal(app.entries[app.cursor].url, "/u/fixture");
  app.back();
  app.flush();
  assert.deepEqual(app.state, [{}]);
  assert.equal(app.entries[app.cursor].url, "/");
});

test("App native Back reaches root after the same root-safe replacement without using browser history", () => {
  const app = appNavigation([{}], { web: false });
  app.commitReplace({ nearby: true, nearbyTab: "shows" });
  app.flush();
  app.back();
  app.flush();
  assert.deepEqual(app.state, [{}]);
  assert.deepEqual(app.calls, []);
});

test("App rejects unavailable destinations before changing either stack or history", () => {
  const app = appNavigation([{}], { prepare: () => null });
  app.commitReplace({ unavailable: true });
  app.commitGo({ unavailable: true });
  app.flush();
  assert.deepEqual(app.state, [{}]);
  assert.deepEqual(app.calls, []);
});

test("App browser Back cancelled by an editing guard restores the consumed history entry", () => {
  const app = appNavigation([{}, { signupSetup: true }]);
  let request;
  app.guardRef.current = (value) => { request = value; };
  app.back();
  app.flush();
  assert.deepEqual(app.state, [{}, { signupSetup: true }]);
  assert.equal(app.cursor, 0);
  request.cancel();
  assert.equal(app.cursor, 1);
  assert.deepEqual(app.calls.map((call) => call.method), ["back", "pushState"]);
  app.guardRef.current = null;
  app.back();
  app.flush();
  assert.deepEqual(app.state, [{}]);
  assert.equal(app.cursor, 0);
});
