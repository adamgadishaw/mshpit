import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { parse } from "@babel/parser";
import { replaceNavigationFrame } from "./navigationStack.mjs";
import { navigationFrameForAccount } from "./memberAccess.mjs";
import { createBrowserHistory } from "./browserHistory.mjs";

const source = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
const syntax = parse(source, { sourceType: "module", plugins: ["jsx"] });
const names = ["cancelPublicRoute", "applyNavigation", "writeNavigation", "runAfterComposerClose", "commitGo", "commitReplace", "popStack", "requestComposerPop", "back", "onPop"];
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
function appNavigation(initialStack = [{}], { web = true, prepare = (frame) => frame, session = { id: "navigation-fixture" }, onRestore = () => assert.fail("fixture unexpectedly missed its cached destination") } = {}) {
  let state = initialStack;
  const queued = [], calls = [], entries = [{ state: null, url: "/" }];
  let cursor = 0, functions;
  const location = { pathname: "/", href: "https://fixture.test/" };
  const updateLocation = () => { location.pathname = entries[cursor].url; location.href = "https://fixture.test" + location.pathname; };
  const move = (delta) => {
    const index = cursor + delta;
    if (index < 0 || index >= entries.length) return;
    cursor = index; updateLocation(); functions.onPop({ state: entries[cursor].state });
  };
  const history = {
    get state() { return entries[cursor].state; },
    pushState(value, title, url) {
      calls.push({ method: "pushState", value, url });
      entries.splice(cursor + 1);
      entries.push({ state: value, url: new URL(url || location.pathname, location.href).pathname });
      cursor++; updateLocation();
    },
    replaceState(value, title, url) {
      calls.push({ method: "replaceState", value, url });
      entries[cursor] = { state: value, url: new URL(url || location.pathname, location.href).pathname };
      updateLocation();
    },
    back() { calls.push({ method: "back" }); move(-1); },
    forward() { calls.push({ method: "forward" }); move(1); },
    go(delta) { calls.push({ method: "go", delta }); move(delta); },
  };
  const stackRef = { current: initialStack };
  const navigationRef = { current: { stack: initialStack, tab: "discover", landing: false, accountId: session?.id || null } };
  const browser = createBrowserHistory({ history, location });
  const base = { ...navigationRef.current, stack: [{}] };
  browser.initialize(base);
  for (let i = 1; i < initialStack.length; i++) browser.write({ ...base, stack: initialStack.slice(0, i + 1) }, initialStack[i].path);
  calls.length = 0;
  const guardRef = { current: null };
  const sessionRef = { current: session };
  functions = runInNewContext(actualFunctions, {
    web, stackRef, navigationRef, replaceNavigationFrame, prepareAvailableNavigationFrame: prepare, navigationFrameForAccount, session,
    pathForFrame: (frame) => frame.path || null, serverDocumentNavigationPath: () => null,
    setStack: (update) => queued.push(update), setTab: () => {}, setLanding: () => {},
    window: { history, location }, browser, browserHistoryRef: { current: browser },
    publicRouteRequestRef: { current: null },
    setPublicNavigationNotice: () => {},
    restoreBrowserPathRef: { current: onRestore },
    composerCloseGuardRef: guardRef, bypassNextPopRef: { current: null },
    authNavigationAbortRef: { current: null }, sessionRef,
  });
  return {
    ...functions, calls, entries, stackRef, guardRef, history, sessionRef,
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

test("guest protected navigation opens one auth frame and Back keeps the public destination", () => {
  const venue = { venueName: "Example Hall", path: "/venue/example" };
  const app = appNavigation([{}, venue], { session: null });
  app.commitGo({ reporting: { id: "member" } });
  app.commitGo({ inbox: true });
  app.flush();
  assert.deepEqual(app.state, [{}, venue, { auth: true }]);
  assert.equal(app.calls.filter(call => call.method === "pushState").length, 1);
  app.back();
  app.flush();
  assert.deepEqual(app.state, [{}, venue]);
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

test("App Forward restores the selected screen instead of popping it again", () => {
  const app = appNavigation();
  app.commitGo({ artistName: "Band", path: "/artist/band" });
  app.commitGo({ post: { id: "p" }, path: "/post/p" });
  app.back(); app.flush();
  assert.equal(app.state.at(-1).artistName, "Band");
  app.history.forward(); app.flush();
  assert.equal(app.state.at(-1).post.id, "p");
  assert.equal(app.entries[app.cursor].url, "/post/p");
});

test("App Forward cannot reopen a cached sign-in screen for an already confirmed member", () => {
  const restores = [];
  const app = appNavigation([{}, { auth: true, path: "/login" }], { onRestore: (path, options) => restores.push({ path, options }) });
  app.history.back(); app.flush();
  app.history.forward(); app.flush();
  assert.equal(restores.length, 1);
  assert.equal(restores[0].path, "/login", "the common authenticated route resolver decides the new destination");
  assert.equal(app.state.at(-1).auth, undefined, "the stale auth form never remounts");
});

test("canceling browser Back preserves the Forward chain", () => {
  const app = appNavigation();
  app.commitGo({ artistName: "Band", path: "/artist/band" });
  app.commitGo({ post: { id: "p" }, path: "/post/p" });
  app.back(); app.flush();
  const length = app.entries.length;
  app.guardRef.current = ({ cancel }) => cancel();
  app.back(); app.flush();
  assert.equal(app.entries.length, length);
  assert.equal(app.state.at(-1).artistName, "Band");
  app.guardRef.current = null;
  app.history.forward(); app.flush();
  assert.equal(app.state.at(-1).post.id, "p");
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
  assert.deepEqual(app.calls.map((call) => call.method), ["back", "go"]);
  app.guardRef.current = null;
  app.back();
  app.flush();
  assert.deepEqual(app.state, [{}]);
  assert.equal(app.cursor, 0);
});

test("App account-boundary Back keeps only a public post ID hint and re-resolves content", () => {
  const requests = [];
  const guestPost = { post: { id: "p", review: "Old guest content" }, path: "/post/p" };
  const app = appNavigation([{}, guestPost], { session: null, onRestore: (path, options) => requests.push(snapshot({ path, options })) });
  app.commitGo({ auth: true, path: "/login" });
  app.flush();
  app.sessionRef.current = { id: "new-member" };
  app.back();
  app.flush();
  assert.deepEqual(requests, [{ path: "/post/p", options: { publicFrameHint: { postId: "p" } } }]);
  assert.equal(app.state.at(-1).auth, true, "old guest content is not painted before the fresh resolver completes");
  assert.match(source, /const restoreBrowserPath = async \(path, \{ replace: replaceUrl = false, publicFrameHint = null \}/);
  assert.match(source, /publicBrowserDestination\(path, \{\s*accountId, signal: controller\.signal, publicFrameHint,/);
});
