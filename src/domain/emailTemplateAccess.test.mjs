import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { emailTemplateEditable } from "./emailTemplateAccess.mjs";

test("template editing fails closed unless matching overview and detail flags agree", () => {
  const summary = { key: "welcome", editable: true };
  const detail = { key: "welcome", editable: true };
  assert.equal(emailTemplateEditable(summary, detail), true);
  assert.equal(emailTemplateEditable({ ...summary, editable: false }, detail), false);
  assert.equal(emailTemplateEditable(summary, { ...detail, editable: false }), false);
  assert.equal(emailTemplateEditable(summary, { ...detail, key: "password_reset" }), false);
  assert.equal(emailTemplateEditable(summary, null), false);
});

test("EmailConsole gates code-owned fields and write controls on the fail-closed decision", () => {
  const source = fs.readFileSync(new URL("../components/EmailConsole.jsx", import.meta.url), "utf8");
  assert.match(source, /editable: emailTemplateEditable\(summary, data\.template\)/);
  assert.match(source, /editable=\{draft\.editable && !busy\}/);
  assert.match(source, /draft\.editable \? <Btn label="Save"/);
  assert.match(source, /draft\.editable && draft\.customized/);
});
