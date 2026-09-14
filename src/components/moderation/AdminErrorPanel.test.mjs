import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { transformSync } from "@babel/core";
import * as diagnostics from "../../domain/errorDiagnostics.mjs";

const require = createRequire(import.meta.url);
const compiled = transformSync(readFileSync(new URL("./AdminErrorPanel.jsx", import.meta.url), "utf8"), {
  filename: "AdminErrorPanel.jsx", configFile: false, babelrc: false,
  plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
}).code;
const flatten = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node)
  ? node.flatMap(flatten) : [node, ...flatten(node.props?.children)];
const text = (node) => node == null || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node)
  : Array.isArray(node) ? node.map(text).join("") : text(node.props?.children);
const rows = (view) => flatten(view).filter((node) => node.props.testID === "retained-error-pattern");
const button = (view, label) => flatten(view).find((node) => node.props.accessibilityLabel === label);
const hour = Date.UTC(2026, 8, 14, 12);
const log = (count = 3) => ({ serious24h: { occurrences: 7, kinds: 3, startedAt: hour - 24 * 3600000, collectedThrough: hour + 61000, omittedKinds: 0,
  patterns: [{ fingerprint: "first", code: "PIT-APP-001", status: 500, level: "fatal", method: "POST", route: "/client/landing", occurrences: 4, lastObservedHour: hour }] },
  last24h: { occurrences: 9, kinds: 4 }, last7Days: { occurrences: 14 },
  errors: Array.from({ length: count }, (_, index) => ({ fingerprint: `pattern-${index}`, code: `FAULT-${index}`, count: 99 + index,
    level: "error", status: 503, method: "POST", route: "/api/media/assets", cause: "TypeError", lastSeen: hour, lastRequestId: `request-${index}` })),
});

function fixture(initial = {}) {
  const slots = [];
  let cursor = 0;
  const calls = { retry: 0, alert: 0 };
  const props = { errorLog: log(), currentRelease: "current-release", onRetry: () => calls.retry++, onSendTestAlert: () => calls.alert++, ...initial };
  const jsx = (type, props) => ({ type, props });
  const seams = (name) => {
    if (name === "react") return { useState(initialValue) { const index = cursor++; if (!(index in slots)) slots[index] = initialValue; return [slots[index], (next) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }]; } };
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "Fragment" };
    if (name === "react-native") return { ActivityIndicator: "ActivityIndicator", Pressable: "Pressable", Text: "Text", View: "View", StyleSheet: { create: (styles) => styles } };
    if (name === "../../theme") return { colors: new Proxy({}, { get: (_, key) => key }), mono: "mono", radius: { md: 16, pill: 99 } };
    if (name === "../../domain/errorDiagnostics.mjs") return diagnostics;
    return require(name);
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)(seams, module, module.exports);
  return { calls, render(next = {}) { Object.assign(props, next); cursor = 0; return module.exports.default(props); } };
}

test("daily serious window, all-fault counts, and retained history are distinct", () => {
  const view = fixture().render();
  assert.match(text(view), /7 serious occurrences across 3 patterns in the hourly-bucketed last 24h/);
  assert.match(text(view), /9 total occurrences \(all fault levels\) in 24h/);
  assert.match(text(view), /99 retained total/);
  assert.match(text(view), /4 in this window/);
  assert.match(text(view), /Pattern: first/);
  assert.match(text(view), /Pattern: pattern-0/);
  assert.match(text(view), /2026-09-14 12:00 UTC \(hour bucket\)/);
  assert.equal(view.props.style[1].borderColor, "danger");
});

test("unavailable serious window is not reported as zero or green", () => {
  for (const serious24h of [null, undefined, {}, { occurrences: -1, kinds: 0 }]) {
    const view = fixture({ errorLog: { ...log(), serious24h } }).render();
    assert.match(text(view), /Serious-fault window unavailable. This is not an all-clear/);
    assert.ok(!view.props.style[1]);
    assert.equal(flatten(view).some((node) => Array.isArray(node.props.style) && node.props.style.some((style) => style?.color === "good")), false);
  }
  const clean = fixture({ errorLog: { ...log(), serious24h: { occurrences: 0, kinds: 0, patterns: [] } } }).render();
  assert.match(text(clean), /0 serious occurrences across 0 patterns/);
});

test("show more reaches the fiftieth returned pattern then stops and can collapse", () => {
  const f = fixture({ errorLog: log(60) });
  let view = f.render();
  assert.equal(rows(view).length, 8);
  for (const expected of [16, 24, 32, 40, 48, 50]) {
    button(view, "Show more error patterns").props.onPress();
    view = f.render();
    assert.equal(rows(view).length, expected);
  }
  assert.equal(button(view, "Show more error patterns"), undefined);
  assert.match(text(view), /FAULT-49/);
  assert.doesNotMatch(text(view), /FAULT-50/);
  button(view, "Show fewer error patterns").props.onPress();
  assert.equal(rows(f.render()).length, 8);
});

test("detail capture is optional, copyable and never substituted for the occurrence time", () => {
  const errorLog = log(2);
  errorLog.errors[0].detail = { release: "captured-release", location: "server/media.js:42", reason: "TypeError [redacted]", capturedAt: hour - 3600000 };
  const view = fixture({ errorLog }).render();
  assert.match(text(view), /Current release: current-release/);
  assert.match(text(view), /Captured release: captured-release/);
  assert.match(text(view), /Where \(redacted\): server\/media.js:42/);
  assert.match(text(view), /Details captured: 2026-09-14 11:00:00.000 UTC/);
  assert.match(text(view), /Last occurred: 2026-09-14 12:00:00.000 UTC/);
  assert.match(text(view), /Redacted diagnostic details unavailable/);
  for (const row of rows(view)) for (const node of flatten(row).filter((node) => node.type === "Text")) {
    assert.equal(node.props.selectable, true);
    assert.equal(node.props.numberOfLines, undefined);
  }
});

test("loading, failed read, retry, empty and test alert controls render honestly", () => {
  const f = fixture({ errorLog: null, loading: true });
  assert.match(text(f.render()), /Loading site errors/);
  assert.doesNotMatch(text(f.render()), /No retained|0 serious/);
  const failed = f.render({ loading: false, loadError: "Site errors could not be loaded. Try again." });
  button(failed, "Retry loading site errors").props.onPress();
  assert.equal(f.calls.retry, 1);
  const empty = f.render({ loadError: "", errorLog: { ...log(0), serious24h: { occurrences: 0, kinds: 0, patterns: [] } } });
  assert.match(text(empty), /No retained patterns returned/);
  flatten(empty).find((node) => node.type === "Pressable" && text(node) === "Send a test alert").props.onPress();
  assert.equal(f.calls.alert, 1);
  const retainedError = f.render({ loadError: "Overview refresh failed" });
  button(retainedError, "Retry loading site errors").props.onPress();
  assert.equal(f.calls.retry, 2, "retained history must not hide refresh recovery");
});
