import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { followTicketLink } from "../domain/ticketLinks.mjs";

const require = createRequire(import.meta.url);
const { code } = require("@babel/core").transformSync(readFileSync(new URL("./ticketLinks.ios.js", import.meta.url), "utf8"), {
  babelrc: false, configFile: false, plugins: [require("@babel/plugin-transform-modules-commonjs")],
});
function fixture() {
  const prompts = [], opened = [], failures = [], module = { exports: {} };
  let token = {};
  new Function("require", "module", "exports", code)(name => name === "react-native" ? {
    Alert: { alert: (title, detail, buttons, options) => prompts.push({ title, detail, buttons, options }) },
    Linking: { openURL: async url => { opened.push(url); } },
  } : { followTicketLink }, module, module.exports);
  const capture = () => { const captured = token; return () => captured === token; };
  return { prompts, opened, failures, capture, revoke: () => { token = {}; },
    open: isCurrent => module.exports.openTicketLink("https://concert-seller.com/ticket", { isCurrent, onFailure: failure => failures.push(failure) }),
  };
}

test("a native ticket confirmation cannot open a covered Show's seller after Back", async () => {
  const f = fixture(), isCurrent = f.capture();
  const result = f.open(isCurrent);
  assert.equal(f.prompts.length, 1);
  f.revoke(); f.prompts[0].buttons.find(button => button.text === "Continue").onPress();
  assert.equal((await result).status, "cancelled");
  assert.deepEqual(f.opened, []); assert.deepEqual(f.failures, []);
  assert.equal((await f.open(isCurrent)).status, "cancelled");
  assert.equal(f.prompts.length, 1);
  const current = f.open(f.capture());
  f.prompts[1].buttons.find(button => button.text === "Continue").onPress();
  assert.equal((await current).status, "opened"); assert.equal(f.opened.length, 1);
});

test("departure between Continue and the opener microtask still rejects external navigation", async () => {
  const f = fixture(), result = f.open(f.capture());
  f.prompts[0].buttons.find(button => button.text === "Continue").onPress();
  f.revoke(); await result;
  assert.deepEqual(f.opened, []); assert.deepEqual(f.failures, []);
});

test("ordinary iOS ticket calls keep confirmation and opener behavior", async () => {
  const f = fixture(), result = f.open(undefined);
  assert.match(f.prompts[0].detail, /concert-seller.com/);
  f.prompts[0].buttons.find(button => button.text === "Continue").onPress();
  assert.equal((await result).status, "opened"); assert.equal(f.opened.length, 1);
});
