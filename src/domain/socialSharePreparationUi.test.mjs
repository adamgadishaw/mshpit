import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { prepareShareCardAsset } from "./shareCardPreparation.mjs";

const require = createRequire(import.meta.url);
const componentSource = require("@babel/core").transformSync(
  readFileSync(new URL("../components/SocialShareStudio.jsx", import.meta.url), "utf8"), {
    babelrc: false, configFile: false,
    plugins: [
      [require.resolve("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }],
      require.resolve("@babel/plugin-transform-modules-commonjs"),
    ],
  },
).code;
const same = (before, after) => before && before.length === after.length
  && before.every((value, index) => Object.is(value, after[index]));
const settle = () => new Promise((resolve) => setImmediate(resolve));
const model = (eventId = "event-a") => ({
  id: eventId, kind: "going", title: "Mock concert", url: "https://fixture.invalid/show/mock",
  accessibilityLabel: "Mock concert share card",
  renderRequest: { kind: "event", eventId, intent: "going" },
});
const asset = (name) => ({ previewUri: `blob:${name}` });
function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
const placeholder = (tree) => nodes(tree).find((node) => node.type?.name === "AuthoritativeShareCardPlaceholder");
const preview = (tree) => nodes(tree).find((node) => node.type === "ExpoImage");
const button = (tree, label) => nodes(tree).find((node) => node.props?.accessibilityLabel === label || node.props?.label === label);

// Execute the actual component and handlers. Only hooks, decorative native views,
// diagnostics storage and the remote asset adapter are seams; deadline/cancel
// logic uses the production lifecycle with a short, deterministic test deadline.
function harness({ timeoutMs = 500, entry = "default" } = {}) {
  const cells = [], effects = [], calls = [], released = [], diagnostics = [];
  let cursor = 0;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in cells)) cells[index] = { value: typeof initial === "function" ? initial() : initial };
      return [cells[index].value, (value) => { cells[index].value = typeof value === "function" ? value(cells[index].value) : value; }];
    },
    useMemo(factory, deps) {
      const index = cursor++;
      if (!same(cells[index]?.deps, deps)) cells[index] = { deps, value: factory() };
      return cells[index].value;
    },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!same(cells[index]?.deps, deps)) {
        effects.push(() => { cells[index]?.cleanup?.(); cells[index] = { deps, cleanup: effect() }; });
      }
    },
  };
  class AppError extends Error {
    constructor(message, options) { super(message || "Unable to prepare"); this.name = "AppError"; Object.assign(this, options); }
  }
  const native = Object.fromEntries(["Modal", "Pressable", "ScrollView", "Text", "View"].map((name) => [name, name]));
  const dependencies = {
    react,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "react-native": { ...native, Platform: { OS: "web" }, StyleSheet: { create: (value) => value, absoluteFill: {} }, useWindowDimensions: () => ({ width: 390 }) },
    "expo-image": { Image: "ExpoImage" },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "../theme": { colors: {}, radius: {}, shadow: {}, space: (value) => value },
    "./Icon": { __esModule: true, default: "Icon" },
    "../domain/socialShareCard.mjs": { socialShareIntentUrl: () => "https://fixture.invalid/share" },
    "../domain/shareCardPreparation.mjs": { prepareShareCardAsset: (prepare, options) => prepareShareCardAsset(prepare, { ...options, timeoutMs }) },
    "../lib/diagnostics": { AppError, captureAppError: (error) => diagnostics.push(error) },
    "../lib/socialShare": {
      instagramStorySharingConfigured: () => false,
      createShareCardAsset: (renderModel, options) => new Promise((resolve, reject) => calls.push({ renderModel, options, resolve, reject })),
      releaseShareCardAsset: (value) => { if (value) released.push(value); },
      copyShareLink: async () => {},
    },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", componentSource)((name) => {
    if (!(name in dependencies)) throw new Error(`Unexpected component dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports);
  const flushEffects = () => { while (effects.length) effects.shift()(); };
  return {
    calls, released, diagnostics, flushEffects,
    render(props, { effects: flush = true } = {}) {
      cursor = 0;
      const tree = module.exports[entry]({ accountId: "account-a", model: model(), onClose() {}, ...props });
      if (flush) flushEffects();
      return tree;
    },
    dispose() { for (const cell of cells) cell?.cleanup?.(); },
  };
}

test("a missing render identity is immediately unavailable, never permanently preparing", () => {
  const h = harness();
  try {
    const tree = h.render({ model: { ...model(), renderRequest: null } });
    assert.equal(placeholder(tree).props.status, "unavailable");
    assert.equal(h.calls.length, 0);
    assert.equal(button(tree, "Copy link").props.disabled, false);
  } finally { h.dispose(); }
});

test("an active unexpected AbortError exits loading and explicit Retry starts exactly one new attempt", async () => {
  const h = harness();
  try {
    h.render(); h.calls[0].reject(Object.assign(new Error("Unexpected abort"), { name: "AbortError" })); await settle();
    const failed = h.render();
    assert.equal(placeholder(failed).props.status, "unavailable");
    button(failed, "Retry share artwork").props.onPress();
    assert.equal(placeholder(h.render()).props.status, "loading");
    assert.equal(h.calls.length, 2);
    const retry = asset("retry"); h.calls[1].resolve(retry); await settle();
    assert.equal(preview(h.render()).props.source.uri, retry.previewUri);
    assert.equal(button(h.render(), "Retry share artwork"), undefined);
  } finally { h.dispose(); }
});

test("a stalled preparation leaves loading independently of fetch abort and releases its late PNG", async () => {
  const h = harness({ timeoutMs: 10 });
  try {
    h.render(); await new Promise((resolve) => setTimeout(resolve, 25));
    const tree = h.render();
    assert.equal(placeholder(tree).props.status, "unavailable");
    assert.equal(h.calls[0].options.signal.aborted, true);
    assert.equal(h.diagnostics.length, 1);
    assert.equal(h.diagnostics[0].code, "PIT-NET-002");
    assert.equal(button(tree, "Copy link").props.disabled, false);
    assert.equal(button(tree, "Download card").props.disabled, true);
    const late = asset("late"); h.calls[0].resolve(late); await settle();
    assert.equal(placeholder(h.render()).props.status, "unavailable");
    assert.deepEqual(h.released, [late]);
    assert.equal(h.diagnostics.length, 1);
  } finally { h.dispose(); }
});

test("old account artwork is hidden synchronously before effect cleanup and cannot replace a new account card", async () => {
  const h = harness();
  try {
    h.render(); const first = asset("account-a"); h.calls[0].resolve(first); await settle();
    assert.equal(preview(h.render()).props.source.uri, first.previewUri);
    const transitioning = h.render({ accountId: "account-b" }, { effects: false });
    assert.equal(preview(transitioning), undefined);
    assert.equal(placeholder(transitioning).props.status, "loading");
    assert.equal(button(transitioning, "Download card").props.disabled, true);
    h.flushEffects();
    assert.deepEqual(h.released, [first]);
    assert.equal(h.calls[1].options.accountId, "account-b");
    const second = asset("account-b"); h.calls[1].resolve(second); await settle();
    assert.equal(preview(h.render({ accountId: "account-b" })).props.source.uri, second.previewUri);
  } finally { h.dispose(); }
});

test("model changes cancel pending work, reject late adoption, and preserve a new ready asset", async () => {
  const h = harness();
  try {
    h.render(); h.render({ model: model("event-b") });
    assert.equal(h.calls[0].options.signal.aborted, true);
    const current = asset("event-b"), obsolete = asset("event-a");
    h.calls[1].resolve(current); h.calls[0].resolve(obsolete); await settle();
    assert.equal(preview(h.render({ model: model("event-b") })).props.source.uri, current.previewUri);
    assert.deepEqual(h.released, [obsolete]);
    assert.equal(h.diagnostics.length, 0);
  } finally { h.dispose(); }
});

test("closing pending preparation cancels quietly and releases any late private asset", async () => {
  const h = harness(); h.render(); h.dispose();
  assert.equal(h.calls[0].options.signal.aborted, true);
  const late = asset("closed"); h.calls[0].resolve(late); await settle();
  assert.deepEqual(h.released, [late]);
  assert.equal(h.diagnostics.length, 0);
});

test("missing rights-cleared artwork remains a distinct non-retry state with Copy link available", async () => {
  const h = harness();
  try {
    h.render(); h.calls[0].reject(Object.assign(new Error("Photo required"), { serverCode: "SHARE_ARTWORK_REQUIRED" })); await settle();
    const tree = h.render();
    assert.equal(placeholder(tree).props.status, "unavailable");
    assert.equal(button(tree, "Retry share artwork"), undefined);
    assert.equal(button(tree, "Copy link").props.disabled, false);
  } finally { h.dispose(); }
});

test("the share trigger remounts its entire Studio for account or immutable item changes, including action feedback", () => {
  const h = harness({ entry: "SocialShareButton" });
  try {
    button(h.render(), "Share going status").props.onPress();
    const studio = (tree) => nodes(tree).find((node) => node.type?.name === "SocialShareStudio");
    const first = studio(h.render()).key;
    assert.equal(studio(h.render({ model: { ...model(), unrelatedRefresh: true } })).key, first);
    assert.notEqual(studio(h.render({ accountId: "account-b" })).key, first);
    assert.notEqual(studio(h.render({ model: model("event-b") })).key, first);
    assert.notEqual(studio(h.render({ model: { ...model(), renderRequest: { ...model().renderRequest, intent: "interested" } } })).key, first);
  } finally { h.dispose(); }
});
