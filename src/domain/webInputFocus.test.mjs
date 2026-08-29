import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  findWebInputFocusBoundary,
  hasVisibleInputBoundary,
  isWebFocusVisible,
} from "../lib/webInputFocus.mjs";

const sourceFilesUnder = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
  if (entry.isDirectory()) return sourceFilesUnder(url);
  return /\.(?:js|jsx|mjs)$/.test(entry.name) ? [url] : [];
});

function element({ style = {}, rect = { width: 240, height: 48 }, parent = null, focusVisible = true, control = false } = {}) {
  return {
    style,
    parentElement: parent,
    getBoundingClientRect: () => rect,
    matches: (selector) => selector === ":focus-visible" ? focusVisible : control && selector === "input, textarea, select",
  };
}

const getStyle = (node) => node.style;

test("focus boundary uses the rounded input itself when it owns the visible field", () => {
  const input = element({
    control: true,
    style: { borderRadius: "18px", borderWidth: "1px", backgroundColor: "rgb(20, 20, 20)" },
  });
  assert.equal(findWebInputFocusBoundary(input, getStyle), input);
});

test("focus boundary moves from a transparent inner input to its rounded field wrapper", () => {
  const wrapper = element({
    style: { borderRadius: "18px", borderWidth: "1px", backgroundColor: "rgb(20, 20, 20)" },
    rect: { width: 340, height: 48 },
  });
  const input = element({
    control: true,
    parent: wrapper,
    style: { borderRadius: "0px", borderWidth: "0px", backgroundColor: "rgba(0, 0, 0, 0)" },
    rect: { width: 250, height: 44 },
  });
  assert.equal(findWebInputFocusBoundary(input, getStyle), wrapper);
});

test("focus boundary never promotes a small input to an oversized rounded panel", () => {
  const panel = element({
    style: { borderRadius: "26px", borderWidth: "1px", backgroundColor: "rgb(20, 20, 20)" },
    rect: { width: 640, height: 420 },
  });
  const input = element({
    control: true,
    parent: panel,
    style: { borderRadius: "0px", borderWidth: "0px", backgroundColor: "transparent" },
    rect: { width: 240, height: 44 },
  });
  assert.equal(findWebInputFocusBoundary(input, getStyle), input);
});

test("painted focus boundaries require a rounded shape and visible chrome", () => {
  assert.equal(hasVisibleInputBoundary({ borderRadius: "18px", borderWidth: "1px", backgroundColor: "transparent" }), true);
  assert.equal(hasVisibleInputBoundary({ borderRadius: "18px", borderWidth: "0px", backgroundColor: "rgb(10, 10, 10)" }), true);
  assert.equal(hasVisibleInputBoundary({ borderRadius: "18px", borderWidth: "0px", backgroundColor: "rgba(0, 0, 0, 0)" }), false);
  assert.equal(hasVisibleInputBoundary({ borderRadius: "0px", borderWidth: "1px", backgroundColor: "rgb(10, 10, 10)" }), false);
});

test("focus visibility follows the browser and remains visible on unsupported engines", () => {
  assert.equal(isWebFocusVisible(element({ focusVisible: true })), true);
  assert.equal(isWebFocusVisible(element({ focusVisible: false })), false);
  assert.equal(isWebFocusVisible({ matches: () => { throw new Error("unsupported selector"); } }), true);
});

test("screens and components leave web input focus ownership to the shared boundary system", () => {
  const roots = [
    new URL("../screens/", import.meta.url),
    new URL("../components/", import.meta.url),
  ];
  const escapes = roots.flatMap(sourceFilesUnder).filter((url) => /outlineStyle\s*:\s*["']none["']/.test(readFileSync(url, "utf8")));
  assert.deepEqual(escapes.map((url) => url.pathname), []);
});
