import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";

const files = {
  reset: "../../screens/ResetPasswordScreen.jsx",
  password: "./AccountPasswordForm.jsx",
  switcher: "./AccountSwitcher.jsx",
};
const sources = Object.fromEntries(Object.entries(files).map(([name, path]) => [name,
  readFileSync(new URL(path, import.meta.url), "utf8")]));
const trees = Object.fromEntries(Object.entries(sources).map(([name, source]) => [name,
  parse(source, { sourceType: "module", plugins: ["jsx"] })]));
function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { node.forEach((child) => walk(child, visit)); return; }
  if (node.type) visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (!["start", "end", "loc", "tokens", "comments"].includes(key)) walk(value, visit);
  }
}
function elements(tree, name) {
  const result = [];
  walk(tree, (node) => {
    if (node.type === "JSXOpeningElement" && node.name?.name === name) result.push(node);
  });
  return result;
}
const attribute = (node, name) => node.attributes.find((value) => value.type === "JSXAttribute" && value.name.name === name);

test("password screens use one shared semantic form and do not bypass it with raw password inputs", () => {
  for (const [name, tree] of Object.entries(trees)) {
    const forms = elements(tree, "CredentialForm");
    assert.equal(forms.length, 1, name);
    assert.ok(attribute(forms[0], "id"), name);
    assert.ok(attribute(forms[0], "onSubmit"), name);
    assert.ok(attribute(forms[0], "disabled"), name);
    if (name !== "reset") assert.ok(attribute(forms[0], "username"), name);
    assert.equal(elements(tree, "TextInput").length, 0, name);
    assert.equal(elements(tree, "form").length, 0, "platform markup belongs in the adapter");
    for (const input of elements(tree, "CredentialInput")) {
      assert.ok(attribute(input, "name"), name);
      assert.ok(attribute(input, "secureTextEntry"), name);
      assert.ok(attribute(input, "autoComplete"), name);
      assert.notEqual(attribute(input, "onSubmitEditing")?.value?.expression?.name, "submit",
        "the final input must not issue a second independent submit");
    }
    assert.ok(elements(tree, "CredentialLabel").every((label) => attribute(label, "htmlFor")), name);
    const submits = elements(tree, "CredentialSubmit").length
      + elements(tree, "Button").filter((button) => attribute(button, "submit")).length;
    assert.equal(submits, 1, name);
  }
});

test("reset and connection fields retain exact autofill names and associated labels", () => {
  for (const [name, expected] of [["reset", ["new-password", "confirm-password"]], ["switcher", ["current-password"]]]) {
    assert.deepEqual(elements(trees[name], "CredentialInput").map((input) => attribute(input, "name").value.value), expected);
    assert.deepEqual(elements(trees[name], "CredentialLabel").map((label) => attribute(label, "htmlFor").value.value), expected);
  }
  assert.match(sources.password, /field\("Current password", "current-password"/);
  assert.match(sources.password, /field\("New password", "new-password"/);
  assert.match(sources.password, /field\("Confirm new password", "confirm-password"/);
});

test("account connection skips empty input and keeps form submission pending through the request", async () => {
  let declaration;
  walk(trees.switcher, (node) => {
    if (node.type === "VariableDeclarator" && node.id.name === "connect") declaration = node.init;
  });
  assert.ok(declaration);
  const callback = sources.switcher.slice(declaration.start, declaration.end);
  const calls = [];
  let finish;
  const request = new Promise((resolve) => { finish = resolve; });
  const perform = (action) => { calls.push(action); return request; };
  const connect = (password) => new Function("password", "perform", `return (${callback});`)(password, perform);
  await connect("")();
  assert.deepEqual(calls, []);
  let completed = false;
  const pending = connect("fixture-password")().then(() => { completed = true; });
  await Promise.resolve();
  assert.deepEqual(calls, ["connect"]);
  assert.equal(completed, false);
  finish();
  await pending;
  assert.equal(completed, true);
});
