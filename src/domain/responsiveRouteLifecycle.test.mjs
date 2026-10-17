import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import React from "react";
import reconciler from "react-reconciler";
import { parse } from "@babel/parser";
import { transformSync } from "@babel/core";

const require = createRequire(import.meta.url);
const appSource = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
const logSource = readFileSync(new URL("../screens/LogScreen.jsx", import.meta.url), "utf8");
let shell, route, reviewState;
function visit(node, inspect) {
  if (!node || typeof node !== "object") return;
  inspect(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((child) => visit(child, inspect));
    else if (value && typeof value === "object") visit(value, inspect);
  }
}
visit(parse(appSource, { sourceType: "module", plugins: ["jsx"] }), (node) => {
  if (node.type === "VariableDeclarator" && node.id.name === "responsiveWeb") shell = appSource.slice(node.init.start, node.init.end);
  if (node.type === "ConditionalExpression" && node.test.name === "web" && node.consequent.name === "responsiveWeb") route = appSource.slice(node.start, node.end);
});
visit(parse(logSource, { sourceType: "module", plugins: ["jsx"] }), (node) => {
  if (node.type === "VariableDeclarator" && node.id.type === "ArrayPattern" && node.id.elements[0]?.name === "review") reviewState = `const ${logSource.slice(node.start, node.end)};`;
});
assert.ok(shell && route && reviewState, "Exercise the actual routed JSX and existing-post review initializer");

const noop = () => {};
function fixture({ deferredDesktopNavigation = false } = {}) {
  let mounts = 0, unmounts = 0, review, setReview;
  const Editor = vm.runInNewContext(`(function Editor({editing}) { ${reviewState}
    expose(review, setReview); useEffect(() => { mount(); return unmount; }, []);
    return React.createElement('textarea', {value: review}); })`, {
    React, useState: React.useState, useEffect: React.useEffect,
    expose: (value, setter) => { review = value; setReview = setter; },
    mount: () => mounts++, unmount: () => unmounts++,
  });
  const passthrough = ({ children }) => React.createElement("div", null, children);
  const nil = () => null;
  const data = {
    React, Suspense: React.Suspense, View: "div", ScreenLoading: nil,
    DesktopTopNav: deferredDesktopNavigation ? React.lazy(() => new Promise(() => {})) : nil,
    PublicWebTrail: nil, PublicDirectoryPanel: nil, RightRail: nil, SponsorPlaceholder: nil,
    ScreenTransition: passthrough, NativeFeedMediaLayer: passthrough, NativeAppHeader: nil,
    styles: {}, web: true, activeTab: "feed", switchTab: noop, session: { id: "fixture" },
    inboxUnread: () => 0, unreadNotifications: () => 0, exitToLanding: noop, preloadComposer: noop,
    requireVerifiedMutation: noop, openNotifications: noop, openInbox: noop, ENABLE_CLIPS: false,
    go: noop, setAcctOpen: noop, hydratedPublicLinks: [], openHydratedPublicTarget: noop,
    showSponsorPlaceholders: false, nav: {}, hydratedDirectoryArtists: [], hydratedDirectoryEvents: [],
    openArtist: noop, openShow: noop, screenKey: "edit:fixture", screenDirection: "fade",
    showRightRail: false, showMobilePublicTrail: false, retainNativeFeed: false,
    mobileTabBar: null, tabScreens: null,
    overlay: React.createElement(Editor, { editing: { review: "Original saved review" } }),
  };
  const body = `function Fixture({width}) { const wide = width >= 1200;
    const responsiveWeb = (${shell}); return (${route}); } globalThis.Fixture = Fixture;`;
  vm.runInNewContext(transformSync(body, {
    configFile: false, babelrc: false,
    plugins: [[require.resolve("@babel/plugin-transform-react-jsx"), { runtime: "classic" }]],
  }).code, data);
  const context = {};
  let priority = 0;
  const append = (parent, child) => parent.children.push(child);
  const remove = (parent, child) => { const index = parent.children.indexOf(child); if (index >= 0) parent.children.splice(index, 1); };
  const insert = (parent, child, before) => parent.children.splice(parent.children.indexOf(before), 0, child);
  // Use installed React reconciliation rather than a mock that cannot observe remounts.
  const renderer = reconciler({
    supportsMutation: true, isPrimaryRenderer: true, supportsPersistence: false, supportsHydration: false,
    getRootHostContext: () => context, getChildHostContext: () => context, getPublicInstance: (node) => node,
    prepareForCommit: () => null, resetAfterCommit: noop,
    createInstance: (type, props) => ({ type, props, children: [] }), createTextInstance: (text) => ({ text }),
    appendInitialChild: append, appendChild: append, appendChildToContainer: append,
    removeChild: remove, removeChildFromContainer: remove, insertBefore: insert, insertInContainerBefore: insert,
    finalizeInitialChildren: () => false, shouldSetTextContent: () => false,
    commitUpdate: (node, type, oldProps, newProps) => { node.props = newProps; },
    commitTextUpdate: (node, oldText, text) => { node.text = text; },
    clearContainer: (node) => { node.children = []; }, resetTextContent: noop, commitMount: noop,
    scheduleTimeout: setTimeout, cancelTimeout: clearTimeout, noTimeout: -1,
    supportsMicrotasks: true, scheduleMicrotask: queueMicrotask,
    getCurrentUpdatePriority: () => priority, setCurrentUpdatePriority: (value) => { priority = value; },
    resolveUpdatePriority: () => priority || 32, shouldAttemptEagerTransition: () => false,
    detachDeletedInstance: noop, maySuspendCommit: () => false, preloadInstance: () => true,
    startSuspendingCommit: noop, suspendInstance: noop, waitForCommitToBeReady: () => null,
    NotPendingTransition: null, HostTransitionContext: React.createContext(null), resetFormInstance: noop,
    bindToConsole: (method, args) => console[method].bind(console, ...args),
  });
  const root = renderer.createContainer({ children: [] }, 1, null, false, null, "", (error) => { throw error; }, (error) => { throw error; }, (error) => { throw error; }, null);
  const flush = (element) => { renderer.updateContainerSync(element, root, null, null); renderer.flushSyncWork(); renderer.flushPassiveEffects(); };
  return {
    render(width, key = data.screenKey) { data.screenKey = key; flush(React.createElement(data.Fixture, { width })); },
    edit(value) { renderer.flushSyncFromReconciler(() => setReview(value)); },
    state: () => ({ review, mounts, unmounts }),
    close() { flush(null); },
  };
}

test("responsive web chrome preserves unsaved existing-post edits in both breakpoint directions", () => {
  const f = fixture();
  try {
    f.render(1280); f.edit("Unsaved review and rating notes");
    for (const width of [1240, 1199, 390, 1200, 1440, 1199]) {
      f.render(width);
      assert.deepEqual(f.state(), { review: "Unsaved review and rating notes", mounts: 1, unmounts: 0 }, `width ${width}`);
    }
  } finally { f.close(); }
});

test("resizing while desktop navigation loads keeps the current editor mounted", () => {
  const f = fixture({ deferredDesktopNavigation: true });
  try {
    f.render(390); f.edit("Keep this while desktop navigation loads");
    f.render(1280); f.render(1199); f.render(1440);
    assert.deepEqual(f.state(), { review: "Keep this while desktop navigation loads", mounts: 1, unmounts: 0 });
  } finally { f.close(); }
});

test("an intentional route-key change still replaces the active screen", () => {
  const f = fixture();
  try {
    f.render(1280); f.edit("First post edit"); f.render(1199, "edit:different-post");
    assert.deepEqual(f.state(), { review: "Original saved review", mounts: 2, unmounts: 1 });
  } finally { f.close(); }
});
