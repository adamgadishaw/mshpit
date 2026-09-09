import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { transformSync } from "@babel/core";
import { parse } from "@babel/parser";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as state from "./credential-form-state.mjs";

const require = createRequire(import.meta.url);
const web = require("react-native-web");
const source = readFileSync(new URL("./credential-form.web.jsx", import.meta.url), "utf8");
const transformed = transformSync(source, {
  filename: "credential-form.web.jsx",
  configFile: false,
  babelrc: false,
  plugins: [
    [require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }],
    require("@babel/plugin-transform-modules-commonjs"),
  ],
}).code;
const adapterModule = { exports: {} };
// Only resolve the local ESM helper. React, JSX runtime, and RN-web are the
// installed packages: no element-factory alias, renderer mock, or HTML fixture
// may conceal an invalid public import in the production adapter.
const adapterRequire = (name) => name === "./credential-form-state.mjs" ? state : require(name);
new Function("require", "module", "exports", transformed)(adapterRequire, adapterModule, adapterModule.exports);
const { default: CredentialForm, CredentialInput, CredentialLabel, CredentialSubmit } = adapterModule.exports;
const h = React.createElement;

function render({ form = {}, input = {}, submit = {} } = {}) {
  return renderToStaticMarkup(h(CredentialForm, { id: "credential-render", onSubmit: async () => {}, ...form },
    h(CredentialLabel, { htmlFor: input.name || "current-password" }, "Current password"),
    h(CredentialInput, {
      name: "current-password", value: "fixture-password", onChangeText() {},
      secureTextEntry: true, autoComplete: "current-password", textContentType: "password",
      autoCapitalize: "none", autoCorrect: false, returnKeyType: "done", maxLength: 100,
      accessibilityLabel: "Current password", accessibilityHint: "Fixture hint",
      accessibilityState: { disabled: false }, ...input,
    }),
    h(CredentialSubmit, { onPress() {}, accessibilityRole: "button", accessibilityLabel: "Save password",
      accessibilityState: { disabled: false, busy: false }, ...submit }, h(web.Text, null, "Save")),
    h(web.Pressable, { onPress() {}, accessibilityRole: "button", accessibilityLabel: "Cancel" }, h(web.Text, null, "Cancel")),
  ));
}
function tagWithName(markup, tag, name) {
  const found = [...markup.matchAll(new RegExp(`<${tag}\\b[^>]*>`, "g"))]
    .map((match) => match[0]).find((value) => value.includes(`name="${name}"`));
  assert.ok(found, `${tag} named ${name} must exist`);
  return found;
}

test("the actual web adapter renders POST form, named password input, and associated label", () => {
  const markup = render();
  assert.match(markup, /<form\b[^>]*method="post"/);
  assert.match(markup, /<form\b[^>]*noValidate=""/);
  assert.match(markup, /<form\b[^>]*autoComplete="on"/);
  assert.match(markup, /<label\b[^>]*for="credential-render-current-password"/);
  const input = tagWithName(markup, "input", "current-password");
  for (const attribute of [
    'id="credential-render-current-password"', 'type="password"', 'autoComplete="current-password"',
    'enterKeyHint="done"', 'maxLength="100"', 'aria-label="Current password"', 'spellCheck="false"',
  ]) assert.ok(input.includes(attribute), attribute);
  assert.doesNotMatch(markup, /secureTextEntry|textContentType|returnKeyType|onChangeText|accessibilityState|accessibilityHint|editable=/);
});

test("a supplied username remains associated without rendering another editable credential field", () => {
  const markup = render({ form: { username: "fixture@example.test" } });
  const username = tagWithName(markup, "input", "username");
  for (const attribute of ['id="credential-render-username"', 'autoComplete="username"', 'readOnly=""', 'hidden=""']) {
    assert.ok(username.includes(attribute), attribute);
  }
  assert.ok(username.includes('value="fixture@example.test"'));
  assert.doesNotMatch(username, /\bdisabled=/);
  assert.equal((markup.match(/<input\b/g) || []).length, 2);
});

test("a locked account email is read-only but remains a named, enabled form control", () => {
  const markup = render({ input: { name: "email", value: "fixture@example.test", secureTextEntry: false,
    keyboardType: "email-address", autoComplete: "username", editable: false } });
  const form = markup.match(/<form\b[^>]*>([\s\S]*?)<\/form>/)?.[1];
  assert.ok(form);
  const email = tagWithName(form, "input", "email");
  for (const attribute of ['id="credential-render-email"', 'type="email"', 'readOnly=""',
    'autoComplete="username"', 'value="fixture@example.test"']) assert.ok(email.includes(attribute), attribute);
  assert.doesNotMatch(email, /\bdisabled=|aria-disabled="true"/,
    "read-only account identity must not be excluded as a disabled form control");
});

test("submit is a real named submit button while cancellation is explicitly non-submitting", () => {
  const markup = render({ submit: { name: "action", value: "save" } });
  const submit = tagWithName(markup, "button", "action");
  assert.ok(submit.includes('type="submit"'));
  assert.ok(submit.includes('value="save"'));
  const buttons = [...markup.matchAll(/<button\b[^>]*>/g)].map((match) => match[0]);
  const cancel = buttons.find((button) => button.includes('aria-label="Cancel"'));
  assert.ok(cancel);
  assert.ok(cancel.includes('type="button"'));
  assert.equal(buttons.filter((button) => button.includes('type="submit"')).length, 1);
});

test("disabled credential controls expose real disabled state without RN-only props", () => {
  const markup = render({ form: { disabled: true, busy: true }, input: { disabled: true, editable: false },
    submit: { disabled: true, accessibilityState: { disabled: true, busy: true } } });
  assert.match(markup, /<form\b[^>]*aria-busy="true"/);
  const input = tagWithName(markup, "input", "current-password");
  assert.ok(input.includes('disabled=""'));
  assert.ok(input.includes('readOnly=""'));
  assert.match(markup, /<button\b(?=[^>]*type="submit")(?=[^>]*disabled="")(?=[^>]*aria-busy="true")/);
  assert.doesNotMatch(markup, /accessibilityState|editable=/);
});

test("native fallback remains native and routes final-field Enter through the shared submit guard", () => {
  const native = readFileSync(new URL("./credential-form.jsx", import.meta.url), "utf8");
  assert.doesNotThrow(() => parse(native, { sourceType: "module", plugins: ["jsx"] }));
  assert.match(native, /import \{ Pressable, Text, TextInput, View \} from "react-native"/);
  assert.match(native, /useRef\(createCredentialSubmitGuard\(\)\)/);
  assert.match(native, /<TextInput \{\.\.\.props\} ref=\{ref\}/);
  assert.match(native, /onSubmitEditing=\{onSubmitEditing \|\| \(form \? \(\) => form.submit\(\)/);
  assert.match(native, /onPress=\{form \? \(\) => form.submit\(\{ name, value \}\) : onPress\}/);
  assert.doesNotMatch(native, /react-native-web|<form\b|<input\b|<button\b/);
});
