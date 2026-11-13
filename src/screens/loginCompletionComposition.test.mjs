import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { parse } from "@babel/parser";
import { createAuthTransitions } from "../domain/authTransitions.mjs";

const require = createRequire(import.meta.url), React = require("react"), reconciler = require("react-reconciler");
const { transformSync } = require("@babel/core");
const noop = () => {}, codes = new Map();
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const walk = node => [node, ...(node.children || []).flatMap(walk)];
const text = node => node.text ?? (node.children || []).map(text).join("");
const compile = (source, filename) => transformSync(source, { filename, babelrc: false, configFile: false,
  plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
}).code;
function createRenderer() {
  const context = {}, container = { children: [] }; let priority = 0;
  const remove = (parent, child) => { const i = parent.children.indexOf(child); if (i >= 0) parent.children.splice(i, 1); };
  const append = (parent, child) => { remove(parent, child); parent.children.push(child); };
  const insert = (parent, child, before) => { remove(parent, child); parent.children.splice(parent.children.indexOf(before), 0, child); };
  const renderer = reconciler({
    supportsMutation: true, isPrimaryRenderer: true, supportsPersistence: false, supportsHydration: false,
    getRootHostContext: () => context, getChildHostContext: () => context, getPublicInstance: node => node,
    prepareForCommit: () => null, resetAfterCommit: noop,
    createInstance: (type, props) => ({ type, props, children: [], focus: noop, scrollTo: noop }), createTextInstance: text => ({ text }),
    appendInitialChild: append, appendChild: append, appendChildToContainer: append,
    removeChild: remove, removeChildFromContainer: remove, insertBefore: insert, insertInContainerBefore: insert,
    finalizeInitialChildren: () => false, shouldSetTextContent: () => false,
    commitUpdate: (node, type, oldProps, props) => { node.props = props; }, commitTextUpdate: (node, oldText, text) => { node.text = text; },
    clearContainer: node => { node.children = []; }, resetTextContent: noop, commitMount: noop,
    scheduleTimeout: setTimeout, cancelTimeout: clearTimeout, noTimeout: -1, supportsMicrotasks: true, scheduleMicrotask: queueMicrotask,
    getCurrentUpdatePriority: () => priority, setCurrentUpdatePriority: value => { priority = value; }, resolveUpdatePriority: () => priority || 32,
    shouldAttemptEagerTransition: () => false, detachDeletedInstance: noop, maySuspendCommit: () => false, preloadInstance: () => true,
    startSuspendingCommit: noop, suspendInstance: noop, waitForCommitToBeReady: () => null, NotPendingTransition: null,
    HostTransitionContext: React.createContext(null), hideInstance: noop, unhideInstance: noop, hideTextInstance: noop, unhideTextInstance: noop,
    resetFormInstance: noop, bindToConsole: (method, args) => console[method].bind(console, ...args),
  });
  const fail = error => { throw error; };
  const root = renderer.createContainer(container, 1, null, false, null, "", fail, fail, fail, null);
  const flush = () => { for (let i = 0; i < 8; i++) { renderer.flushSyncWork(); if (!renderer.flushPassiveEffects()) break; } };
  return { container, render(element) { renderer.updateContainerSync(element, root, null, null); flush(); }, act(callback) { renderer.flushSyncFromReconciler(callback); flush(); } };
}
function declarations(file, names) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8"), found = new Map();
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "VariableDeclarator" && names.includes(node.id?.name)) found.set(node.id.name, source.slice(node.init.start, node.init.end));
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === "object") visit(value);
  }
  visit(parse(source, { sourceType: "module", plugins: ["jsx"] }));
  for (const name of names) assert.ok(found.has(name), name);
  return found;
}
const rootPresentations = declarations("../../App.js", ["presentNativeScreen", "presentScreen"]);
const storeAuth = declarations("../store.js", ["performAuthentication", "login"]);

// Real AuthScreen + native credential controls + Root's exact account-keyed
// presentation + Store's actual login/transition functions. Only IO, account
// publication and unrelated chrome are fixtures. No real credentials/network.
function fixture({ platform = "ios", strict = false, commitBeforeContinuation = true, failDurability } = {}) {
  const renderer = createRenderer(), requests = [], done = [], events = [], Store = React.createContext(null);
  const navigationAbortRef = { current: null }, authValidationSequenceRef = { current: 0 };
  let session = null, setAccount, show = true, intent = null, credential;
  const native = { Platform: { OS: platform }, StyleSheet: { create: value => value }, View: "View", Text: "Text", TextInput: "TextInput", Pressable: "Pressable", ActivityIndicator: "ActivityIndicator", KeyboardAvoidingView: "KeyboardAvoidingView" };
  const execute = file => {
    const url = new URL(file, import.meta.url), key = url.href;
    if (!codes.has(key)) codes.set(key, compile(readFileSync(url, "utf8"), url.pathname));
    const module = { exports: {} }, local = createRequire(url);
    new Function("require", "module", "exports", codes.get(key))(name => {
      if (name === "react") return React;
      if (name === "react-native") return native;
      if (name === "react-native-safe-area-context") return { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) };
      if (name === "../store") return { useStore: () => React.useContext(Store) };
      if (name === "../hooks/useIOSAuthErrorAnnouncement") return { __esModule: true, default: () => ({ cancel: noop, begin: noop, finish: noop }) };
      if (name === "../components/credential-form") return credential;
      if (name === "../features/signupHandle/useSignupHandleAvailability") return { useSignupHandleAvailability: () => ({ resource: { status: "idle" }, retry: noop }) };
      if (name === "../lib/lazyWithRetry") return { lazyWithRetry: () => "LazyContent" };
      if (name === "../theme") return { colors: {}, radius: {}, shadow: {}, space: n => n };
      if (name.startsWith("../components/")) return { __esModule: true, default: name.split("/").at(-1) };
      return local(name);
    }, module, module.exports);
    return module.exports;
  };
  credential = execute("../components/credential-form.jsx");
  const Auth = execute("./AuthScreen.jsx").default, ReviewPresentation = execute("../components/ReviewPresentation.jsx").default;
  const transitions = createAuthTransitions({ read: () => intent, write: next => { intent = next; }, revoke: async () => events.push("revoke"),
    confirmIntent: (_ticket, phase) => { if (phase === failDurability) throw new Error("Synthetic durable intent unavailable"); } });
  const logout = () => { session = null; events.push("logout"); return transitions.signOut(); };
  const api = (url, options) => { assert.equal(url, "/api/login"); const request = { ...deferred(), options }; requests.push(request); return request.promise; };
  const absorbServerUser = user => {
    session = user; events.push("adopt");
    // An account commit is permitted before the outer async login continuation.
    // Flush that interleaving deliberately; it changes the checked-in Root key.
    if (commitBeforeContinuation) renderer.act(() => setAccount(user)); else setAccount(user);
  };
  const login = new Function("authValidationSequenceRef", "authTransitions", "logout", "localCommandError", "remoteIdentityValidationEnabled", "LOCAL_AUTH_FALLBACK", "api", "absorbServerUser", "track",
    `const performAuthentication = ${storeAuth.get("performAuthentication")}; return ${storeAuth.get("login")};`)(authValidationSequenceRef, transitions, logout, () => ({ ok: false }), () => true, false, api, absorbServerUser, noop);
  const presentation = rootPresentations.get(platform === "web" ? "presentScreen" : "presentNativeScreen");
  // The compiled Root expression resolves the actual presentation component and
  // ordinary view boundary; preserve its live session key rather than hardcode it.
  const Host = new Function("ReviewPresentation", "View", "ScreenTransition", "isReviewDetail", "back", "ScreenLoading", "styles", "require", "module", "exports",
    compile(`module.exports = function Host({ session, children }) { const stack=[{}, {auth:true}], screenKey="auth:login", screenDirection="push", nav={auth:true}; const present=${presentation}; return present(children); };`, "login-root.cjs")+";return module.exports;")(
    ReviewPresentation, "View", ({children}) => children, () => false, noop, () => null, {}, require, {exports:{}}, {});
  function Root() {
    const [account, update] = React.useState(null); setAccount = update;
    return React.createElement(Store, {value:{login,session:account,chatAuthEpoch:account?2:1}}, React.createElement(Host,{session:account},show ? React.createElement(Auth,{navigationAbortRef,onDone:(...args)=>{done.push(args);events.push("done");navigationAbortRef.current?.();show=false;}}) : React.createElement(ViewFixture)));
  }
  function ViewFixture() { return React.createElement("Done"); }
  const render = () => renderer.render(React.createElement(strict ? React.StrictMode : React.Fragment, null, React.createElement(Root)));
  const all = () => walk(renderer.container), input = name => all().find(n => n.type === "TextInput" && n.props.nativeID.endsWith(`-${name}`));
  const button = (label = "Log in") => all().find(n => n.type === "Pressable" && text(n) === label);
  render();
  return { requests, done, events, transitions, navigationAbortRef, input, all, render, button,
    get session() { return session; },
    autofill() { renderer.act(() => { input("email").props.onChangeText("synthetic@example.test"); input("password").props.onChangeText("Synthetic-password1"); }); },
    submit(label) { let pending; renderer.act(() => { pending = button(label).props.onPress(); }); return pending; },
    burst() { const press = button().props.onPress, enter = input("password").props.onSubmitEditing; let pending; renderer.act(() => { pending = press(); void press(); void enter(); }); return pending; },
    externalAccount(user) { session = user; renderer.act(() => setAccount(user)); },
    async settle() { for (let i=0;i<8;i++) { await new Promise(resolve => setImmediate(resolve)); renderer.act(noop); } },
    close() { renderer.render(null); },
  };
}

for (const strict of [false,true]) test(`autofilled login completes once when account commit precedes form continuation (StrictMode ${strict})`, async t => {
  const f = fixture({strict}); t.after(f.close); f.autofill();
  const pending = f.submit(); await f.settle(); assert.equal(f.requests.length,1);
  f.requests[0].resolve({user:{id:"synthetic-member",emailVerified:true}}); await pending; await f.settle();
  assert.equal(f.session?.id,"synthetic-member");
  assert.equal(f.done.length,1,"Accepted sign-in must close the original login flow, not remount an empty form");
  assert.equal(f.done[0][1].accountId,"synthetic-member");
  assert.deepEqual(f.events,["done","adopt"],"Accepted completion retires cancellation before account publication");
  assert.equal(f.events.includes("revoke"),false);
});

for (const platform of ["ios","android","web"]) test(`${platform}: autofill and same-turn button/keyboard repeats dispatch one login`, async t => {
  const f = fixture({platform}); t.after(f.close); f.autofill();
  assert.equal(f.input("email").props.autoComplete,"username");
  assert.equal(f.input("password").props.secureTextEntry,true);
  const pending=f.burst(); await f.settle(); assert.equal(f.requests.length,1);
  assert.deepEqual(f.requests[0].options.body,{email:"synthetic@example.test",password:"Synthetic-password1"});
  assert.equal(f.input("password").props.editable,false);
  f.requests[0].resolve({user:{id:"synthetic-member"}}); await pending; await f.settle();
  assert.equal(f.done.length,1); assert.equal(f.requests.length,1); assert.equal(f.events.includes("logout"),false);
});

test("two rejected logins retain autofilled fields and a third accepted attempt closes exactly once", async t => {
  const f=fixture(); t.after(f.close); f.autofill();
  const email=f.input("email"), password=f.input("password");
  for(let i=0;i<2;i++) {
    const pending=f.submit(); await f.settle();
    f.requests[i].reject(Object.assign(new Error("Synthetic wrong email or password"),{status:401})); await pending; await f.settle();
    assert.equal(f.input("email"),email); assert.equal(f.input("password"),password);
    assert.equal(password.props.value,"Synthetic-password1"); assert.equal(f.done.length,0);
    assert.ok(f.all().some(n=>n.text==="Synthetic wrong email or password"));
  }
  const pending=f.submit(); await f.settle(); f.requests[2].resolve({user:{id:"synthetic-member"}}); await pending; await f.settle();
  assert.equal(f.requests.length,3); assert.equal(f.done.length,1); assert.equal(f.events.includes("revoke"),false);
});

for(const status of [undefined,503]) test(`uncertain transport ${status ?? "offline"} never reports success and retains fields for explicit retry`,async t=>{
  const f=fixture(); t.after(f.close); f.autofill(); const password=f.input("password");
  const pending=f.submit(); await f.settle(); f.requests[0].reject(Object.assign(new Error("Synthetic transport failure"),status?{status}:{}));
  await pending; await f.settle(); assert.equal(f.done.length,0); assert.equal(f.session,null); assert.equal(f.input("password"),password); assert.equal(password.props.value,"Synthetic-password1");
  assert.equal(f.events.includes("revoke"),true);
  const retry=f.submit(); await f.settle(); f.requests[1].resolve({user:{id:"synthetic-member"}}); await retry; await f.settle(); assert.equal(f.done.length,1);
});

for(const cancellation of ["navigation","unmount","account"]) test(`${cancellation} before response prevents accepted navigation and identity adoption`,async t=>{
  const f=fixture(); t.after(f.close); f.autofill(); const pending=f.submit(); await f.settle();
  if(cancellation==="navigation") f.navigationAbortRef.current();
  else if(cancellation==="unmount") f.close();
  else f.externalAccount({id:"other-synthetic-member"});
  f.requests[0].resolve({user:{id:"synthetic-member"}}); await pending; await f.settle();
  assert.equal(f.done.length,0); assert.equal(f.events.includes("adopt"),false); assert.equal(f.events.includes("revoke"),true);
});

test("account choice keeps the credential visit until explicit accepted selection",async t=>{
  const f=fixture(); t.after(f.close); f.autofill(); const pending=f.submit(); await f.settle();
  f.requests[0].resolve({chooseAccount:true,accounts:[{id:"one",name:"One",handle:"one"},{id:"two",name:"Two",handle:"two"}]});
  await pending; await f.settle(); assert.equal(f.done.length,0); assert.equal(f.session,null);
  const choice=f.all().find(n=>n.type==="Pressable"&&text(n).includes("One")&&text(n).includes("@one")); assert.ok(choice);
  const accepted=choice.props.onPress(); await f.settle(); assert.equal(f.requests[1].options.body.accountId,"one");
  f.requests[1].resolve({user:{id:"one"}}); await accepted; await f.settle(); assert.equal(f.done.length,1); assert.equal(f.done[0][1].accountId,"one");
});

test("malformed success cannot complete or retain a fabricated session",async t=>{
  const f=fixture(); t.after(f.close); f.autofill(); const pending=f.submit(); await f.settle(); f.requests[0].resolve({ok:true});
  await pending; await f.settle(); assert.equal(f.done.length,0); assert.equal(f.session,null); assert.equal(f.input("password").props.value,"Synthetic-password1");
});

for (const phase of ["pending", "signed-in"]) test(`${phase} durability failure never completes navigation or adopts identity`, async t => {
  const f = fixture({ failDurability: phase }); t.after(f.close); f.autofill();
  const pending = f.submit(); await f.settle();
  if (phase === "signed-in") f.requests[0].resolve({ user: { id: "synthetic-member" } });
  await pending; await f.settle();
  assert.equal(f.requests.length, phase === "pending" ? 0 : 1);
  assert.equal(f.done.length, 0); assert.equal(f.session, null);
  assert.equal(f.input("password").props.value, "Synthetic-password1");
  assert.equal(f.events.includes("revoke"), phase === "signed-in");
});

test("accepted login completes once when React batches identity publication", async t => {
  const f = fixture({ commitBeforeContinuation: false }); t.after(f.close); f.autofill();
  const pending = f.submit(); await f.settle(); f.requests[0].resolve({ user: { id: "synthetic-member" } });
  await pending; await f.settle();
  assert.equal(f.done.length, 1); assert.equal(f.session.id, "synthetic-member");
  assert.equal(f.events.includes("revoke"), false);
});
