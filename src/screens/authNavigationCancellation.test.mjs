import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { transformSync } from "@babel/core";
import * as signupForm from "../domain/signupForm.mjs";
import * as validation from "../domain/validation.mjs";
import { createAuthTransitions } from "../domain/authTransitions.mjs";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("./AuthScreen.jsx", import.meta.url), "utf8");
const compiled = transformSync(source, {
  filename: "AuthScreen.jsx", configFile: false, babelrc: false,
  plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
}).code;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
const nodes = (node) => Array.isArray(node) ? node.flatMap(nodes)
  : node && typeof node === "object" ? [node, ...nodes(node.props?.children)] : [];

function fixture({ login, onDone = () => {} }) {
  const states = [], refs = [], effects = [], pendingEffects = [];
  let stateIndex = 0, refIndex = 0, effectIndex = 0;
  const navigationAbortRef = { current: null };
  const effect = (create, deps = []) => {
    const index = effectIndex++, previous = effects[index];
    if (previous && deps.every((value, at) => Object.is(value, previous.deps[at]))) return;
    pendingEffects.push(() => { previous?.cleanup?.(); effects[index] = { deps, cleanup: create() }; });
  };
  const seams = (name) => {
    if (name === "react") return {
      useState(initial) {
        const index = stateIndex++;
        if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
        return [states[index], (next) => { states[index] = typeof next === "function" ? next(states[index]) : next; }];
      },
      useRef(initial) { const index = refIndex++; return refs[index] ||= { current: initial }; },
      useEffect: effect, useLayoutEffect: effect,
    };
    if (name === "react-native") return {
      ActivityIndicator: "ActivityIndicator", KeyboardAvoidingView: "KeyboardAvoidingView", Pressable: "Pressable",
      ScrollView: "ScrollView", Text: "Text", View: "View", Platform: { OS: "web" }, StyleSheet: { create: (value) => value },
    };
    if (name === "react-native-safe-area-context") return { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) };
    if (name === "../store") return { useStore: () => ({ login, signup: () => assert.fail("Unexpected signup"), session: null }) };
    if (name === "../theme") return { colors: {}, radius: {}, shadow: {}, space: (value) => value * 4 };
    if (name === "../domain/signupForm.mjs") return signupForm;
    if (name === "../domain/validation.mjs") return validation;
    if (name === "../domain/genrePreferences.mjs") return { PROFILE_GENRE_MAX: 3, PROFILE_GENRE_OPTIONS: [] };
    if (name === "../features/signupHandle/useSignupHandleAvailability") return {
      useSignupHandleAvailability: () => ({ resource: { status: "idle" }, retry: () => {} }),
    };
    if (name === "../components/credential-form") return {
      __esModule: true, default: "CredentialForm", CredentialInput: "CredentialInput", CredentialLabel: "CredentialLabel", CredentialSubmit: "CredentialSubmit",
    };
    if (name.startsWith("../components/") || name === "./PrivacyScreen" || name === "./TermsScreen") return { __esModule: true, default: name };
    return require(name);
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)(seams, module, module.exports);
  const render = () => {
    stateIndex = 0; refIndex = 0; effectIndex = 0;
    const tree = module.exports.default({ navigationAbortRef, onDone });
    while (pendingEffects.length) pendingEffects.shift()();
    return nodes(tree);
  };
  const submit = () => {
    let tree = render();
    tree.find((node) => node.type === "CredentialInput" && node.props.name === "email").props.onChangeText("fixture@example.test");
    tree.find((node) => node.type === "CredentialInput" && node.props.name === "password").props.onChangeText("fixture-password1");
    tree = render();
    return tree.find((node) => node.type === "CredentialForm").props.onSubmit();
  };
  return { navigationAbortRef, render, submit };
}

test("navigation abort revokes a held login before unmount even if the destination suspends", async () => {
  const response = deferred(), calls = [];
  let state = null, signal;
  const transitions = createAuthTransitions({ read: () => state, write: (next) => { state = next; }, revoke: async () => calls.push("revoke") });
  const f = fixture({
    login: (_email, _password, _id, options) => {
      signal = options.signal;
      return transitions.run({ signal, request: () => response.promise, accept: () => { calls.push("adopt"); return { ok: true }; },
        onCancel: () => { calls.push("cancel"); void transitions.signOut(); } });
    },
    onDone: () => calls.push("done"),
  });
  const pending = f.submit();
  await tick();
  f.navigationAbortRef.current();
  assert.equal(signal.aborted, true, "Back must abort synchronously, without React effect cleanup");
  assert.deepEqual(calls, ["cancel"]);
  response.resolve({ user: { id: "fixture-member" } });
  await pending; await tick();
  assert.deepEqual(calls, ["cancel", "revoke"]);
  assert.equal(transitions.blocked(), true);
  const rendered = f.render();
  assert.equal(rendered.find((node) => node.type === "CredentialInput" && node.props.name === "password").props.value, "");
  assert.equal(rendered.find((node) => node.type === "CredentialForm").props.busy, false);
});

test("a canceled still-mounted form ignores a late transport error", async () => {
  const response = deferred();
  const f = fixture({ login: () => response.promise, onDone: () => assert.fail("Canceled completion") });
  const pending = f.submit();
  f.navigationAbortRef.current();
  response.reject(new Error("Late network failure must not surface"));
  await pending;
  assert.equal(f.render().some((node) => node.props?.children === "Late network failure must not surface"), false);
});

test("successful sign-in clears its attempt before completion navigates Back", async () => {
  let signal, done = 0;
  const f = fixture({
    login: async (_email, _password, _id, options) => { signal = options.signal; return { ok: true }; },
    onDone: () => { done += 1; f.navigationAbortRef.current(); },
  });
  await f.submit();
  assert.equal(done, 1);
  assert.equal(signal.aborted, false, "Accepted sign-in must not be treated as navigation cancellation");
});

test("root navigation cancels auth before changing screens, but not when a composer blocks navigation", () => {
  const app = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
  const begin = app.indexOf("  const runAfterComposerClose = "), end = app.indexOf("  const commitGo = ", begin);
  assert.ok(begin >= 0 && end > begin);
  const calls = [], guard = { current: null };
  const run = new Function("authNavigationAbortRef", "composerCloseGuardRef", `${app.slice(begin, end)}; return runAfterComposerClose;`)({ current: () => calls.push("abort") }, guard);
  run(() => calls.push("navigate"));
  assert.deepEqual(calls, ["abort", "navigate"]);
  calls.length = 0;
  let pending;
  guard.current = (options) => { pending = options; };
  run(() => calls.push("navigate"));
  assert.deepEqual(calls, []);
  pending.cancel();
  assert.deepEqual(calls, []);
  pending.proceed();
  assert.deepEqual(calls, ["abort", "navigate"]);
  assert.match(app, /const popStack = \(\) => \{\s+authNavigationAbortRef\.current\?\.\(\);/);
  assert.equal((app.match(/<AuthScreen navigationAbortRef=\{authNavigationAbortRef\}/g) || []).length, 2);
});
