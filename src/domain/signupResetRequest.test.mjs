import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "@babel/parser";

const source = readFileSync(new URL("../store.js", import.meta.url), "utf8");
const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
const store = ast.program.body.find((node) => node.type === "ExportNamedDeclaration" && node.declaration?.id?.name === "StoreProvider").declaration;
const reset = store.body.body.flatMap((node) => node.type === "VariableDeclaration" ? node.declarations : []).find((node) => node.id.name === "forgotPassword").init;
const makeReset = (api) => new Function("api", `return (${source.slice(reset.start, reset.end)});`)(api);

test("password reset remains neutral after server acknowledgment", async () => {
  for (const email of ["new@example.test", "existing@example.test"]) {
    const calls = [];
    const result = await makeReset(async (...args) => { calls.push(args); return { ok: true }; })(email);
    assert.deepEqual(result, { ok: true });
    assert.equal(calls[0][0], "/api/forgot");
    assert.equal(calls[0][1].body.email, email);
  }
});
test("a reset transport failure never claims an email was sent", async () => {
  const error = new Error("offline");
  const result = await makeReset(async () => { throw error; })("member@example.test");
  assert.deepEqual(result, { ok: false, error });
});
