import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parse } from "@babel/parser";

const source = readFileSync(new URL("./dmReadApi.mjs", import.meta.url), "utf8");
const ast = parse(source, { sourceType: "module" });
const declarations = ast.program.body.filter(node => node.declaration?.type === "FunctionDeclaration")
  .map(node => source.slice(node.declaration.start, node.declaration.end)).join("\n");

test("targeted read transport carries only the message ID, owner and cancellation to a distinct route", async () => {
  const calls = [], signal = new AbortController().signal;
  const { writeDirectMessageRead } = new Function("api", `${declarations}; return {writeDirectMessageRead};`)(async (...args) => { calls.push(args); return { ok: true }; });
  await writeDirectMessageRead("peer/special", { messageId: "visible-message", expectedAccountId: "owner", signal });
  assert.equal(calls[0][0], "/api/dms/peer%2Fspecial/read-through");
  assert.deepEqual(calls[0][1].body, { messageId: "visible-message" });
  assert.equal(calls[0][1].expectedAccountId, "owner");
  assert.equal(calls[0][1].signal, signal);
  assert.equal(calls[0][1].method, "POST");
});

test("an old server 404 has no fallback to its blanket read endpoint", async () => {
  const calls = [];
  const { writeDirectMessageRead } = new Function("api", `${declarations}; return {writeDirectMessageRead};`)(async (...args) => { calls.push(args); throw Object.assign(new Error("Not found"), { status: 404 }); });
  await assert.rejects(writeDirectMessageRead("peer", { messageId: "observed" }), { status: 404 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "/api/dms/peer/read-through");
});
