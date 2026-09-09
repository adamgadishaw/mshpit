import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";

const screenNames = ["SettingsScreen", "AccountGate", "DeleteAccountScreen", "OwnerApprovalScreen"];
const sources = new Map(screenNames.map((name) => {
  const source = readFileSync(new URL(`./${name}.jsx`, import.meta.url), "utf8");
  return [name, { source, ast: parse(source, { sourceType: "module", plugins: ["jsx"] }) }];
}));

function walk(node, visit, ancestors = []) {
  if (!node || typeof node !== "object") return;
  visit(node, ancestors);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) { for (const item of value) walk(item, visit, [...ancestors, node]); }
    else if (value && typeof value === "object") walk(value, visit, [...ancestors, node]);
  }
}
const elementName = (node) => node?.type === "JSXElement" ? node.openingElement.name?.name : null;
const attribute = (node, name) => node.openingElement.attributes.find((item) => item.name?.name === name);
const literal = (node, name) => attribute(node, name)?.value?.value;

for (const screen of screenNames) {
  test(`${screen} puts its credential input and associated label in one narrowly scoped form`, () => {
    const inputs = [], forms = [], labels = [];
    walk(sources.get(screen).ast, (node, ancestors) => {
      if (elementName(node) === "CredentialForm") forms.push(node);
      if (elementName(node) === "CredentialLabel") labels.push(node);
      if (elementName(node) !== "CredentialInput") return;
      const owners = ancestors.filter((ancestor) => elementName(ancestor) === "CredentialForm");
      assert.equal(owners.length, 1, "A credential needs one form owner, never nested forms");
      assert.equal(literal(node, "name"), "current-password");
      assert.equal(literal(node, "autoComplete"), "current-password");
      assert.equal(attribute(node, "onSubmitEditing"), undefined, "Form owns Enter; it must not submit twice");
      assert.ok(attribute(owners[0], "onSubmit"));
      inputs.push(node);
    });
    assert.equal(inputs.length, 1);
    assert.equal(forms.length, 1);
    assert.equal(labels.filter((node) => literal(node, "htmlFor") === "current-password").length, 1);
    assert.ok(attribute(forms[0], "disabled"));
    assert.ok(attribute(forms[0], "username"));
  });
}

function callback(screen, name, bindings) {
  const { source, ast } = sources.get(screen);
  let found;
  walk(ast, (node) => {
    if (node.type === "VariableDeclarator" && node.id?.name === name) found = node.init;
  });
  assert.ok(found, name);
  return new Function(...Object.keys(bindings), `return (${source.slice(found.start, found.end)});`)(...Object.values(bindings));
}

for (const [screen, name, service] of [["SettingsScreen", "doExport", "exportMyData"], ["AccountGate", "exportData", "onExport"]]) {
  function fixture(response, password = "private-password") {
    const busy = [], results = [], passwords = [], requests = [];
    const run = callback(screen, name, {
      exporting: false, exportPassword: password,
      setExporting: (value) => busy.push(value), setExportResult: (value) => results.push(value),
      setExportPassword: (value) => passwords.push(value),
      [service]: async (value) => { requests.push(value); return response(); },
    });
    return { run, busy, results, passwords, requests };
  }
  test(`${screen} reports thrown export errors and always releases busy state`, async () => {
    const f = fixture(() => { throw new Error("offline"); }); await f.run();
    assert.deepEqual(f.busy, [true, false]); assert.equal(f.results.at(-1).ok, false);
    assert.equal(f.results.at(-1).error, "Pit could not prepare your data file.");
    assert.deepEqual(f.passwords, []);
  });
  test(`${screen} successful export clears the password without changing the request`, async () => {
    const f = fixture(() => ({ ok: true })); await f.run();
    assert.deepEqual(f.requests, ["private-password"]); assert.deepEqual(f.passwords, [""]);
    assert.deepEqual(f.busy, [true, false]); assert.equal(f.results.at(-1).ok, true);
  });
  test(`${screen} rejects empty credentials before an export request`, async () => {
    const f = fixture(() => assert.fail("submitted"), ""); await f.run();
    assert.deepEqual(f.requests, []); assert.deepEqual(f.busy, []);
  });
}

test("deletion errors keep the confirmation open and release busy state", async () => {
  const busy = [], errors = [];
  const run = callback("DeleteAccountScreen", "submit", {
    password: "private-password", deleting: false,
    setDeleting: (value) => busy.push(value), setError: (value) => errors.push(value),
    setPassword: () => assert.fail("must retain failed confirmation"), onDeleted: () => assert.fail("not deleted"),
    deleteAccount: async () => { throw new Error("offline"); },
  });
  await run(); assert.deepEqual(busy, [true, false]);
  assert.equal(errors.at(-1), "Your account couldn't be deleted. Try again.");
});

test("confirmed deletion clears credentials and reports completion once", async () => {
  const calls = [], busy = [];
  const run = callback("DeleteAccountScreen", "submit", {
    password: "private-password", deleting: false,
    setDeleting: (value) => busy.push(value), setError: () => {},
    setPassword: (value) => calls.push(["password", value]), onDeleted: () => calls.push(["deleted"]),
    deleteAccount: async (value) => { calls.push(["request", value]); return { ok: true }; },
  });
  await run(); assert.deepEqual(calls, [["request", "private-password"], ["password", ""], ["deleted"]]);
  assert.deepEqual(busy, [true, false]);
});

test("owner approval requires an explicit named decision; Enter alone cannot approve or reject", async () => {
  const decisions = [], errors = [];
  const submit = callback("OwnerApprovalScreen", "submitDecision", {
    decide: async (decision) => decisions.push(decision), setActionError: (value) => errors.push(value),
  });
  for (const missing of [undefined, null, {}, { value: "approved" }, { name: "wrong", value: "approved" }, { name: "decision", value: "invented" }]) await submit(missing);
  assert.deepEqual(decisions, []); assert.equal(errors.length, 6);
  await submit({ name: "decision", value: "rejected" });
  await submit({ name: "decision", value: "approved" });
  assert.deepEqual(decisions, ["rejected", "approved"]);
  let form;
  walk(sources.get("OwnerApprovalScreen").ast, (node) => { if (elementName(node) === "CredentialForm") form = node; });
  assert.ok(attribute(form, "requireExplicitSubmitter"), "Browser implicit Enter must not synthesize a decision");
});

test("an owner-decision failure releases its lock and clears the password", async () => {
  const busy = [], passwords = [], errors = [];
  const decide = callback("OwnerApprovalScreen", "decide", {
    busyDecision: null, password: "private-password", remaining: { expired: false }, token: "private-token",
    setBusyDecision: (value) => busy.push(value), setActionError: (value) => errors.push(value),
    setPassword: (value) => passwords.push(value),
    decideOwnerApproval: async () => { throw new Error("offline"); },
    decisionFailureCopy: () => "The decision could not be recorded.",
  });
  await decide("rejected");
  assert.deepEqual(busy, ["rejected", null]); assert.deepEqual(passwords, [""]);
  assert.equal(errors.at(-1), "The decision could not be recorded.");
});
