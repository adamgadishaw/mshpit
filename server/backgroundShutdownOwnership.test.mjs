import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parse } from "@babel/parser";
import { transformFromAstSync } from "@babel/core";

const source = readFileSync(new URL("./index.js", import.meta.url), "utf8");
const ast = parse(source, { sourceType: "module" });
const shutdown = ast.program.body.find(node => node.type === "FunctionDeclaration" && node.id?.name === "shutdown");
const declaration = shutdown.body.body.find(node => node.type === "VariableDeclaration" && node.declarations.some(item => item.id.name === "additionalStops"));
const compiled = transformFromAstSync({ type: "File", program: { type: "Program", sourceType: "script", body: [declaration] } }, "", { configFile: false, babelrc: false }).code;
const stop = new Function("additionalSchedulers", "console", "safeRequestFailureContext", `${compiled}; return additionalStops;`);

test("all newly introduced database workers retain a shutdown handle", () => {
  for (const name of ["privacy-journal", "video-processing", "catalog-research", "web-profiles", "artist-news", "news-desk", "artist-photos"]) {
    assert.ok(source.includes(`additionalSchedulers.set("${name}", startBackgroundRuntime("/startup/${name}"`), name);
  }
  const wait = source.indexOf("await additionalStops;");
  assert.ok(wait > source.indexOf("server.close(async () =>"));
  assert.ok(wait < source.indexOf("try { db.close(); }"));
});

test("shutdown aborts every owned worker and waits for unsettled database work despite another failure", async () => {
  let finish, settled = false;
  const calls = [], errors = [];
  const schedulers = new Map([
    ["slow", { stop: options => { calls.push(options); return new Promise(resolve => { finish = resolve; }); } }],
    ["broken", { stop: options => { calls.push(options); throw new Error("private remote response"); } }],
    ["disabled", null],
    ["last", { stop: options => { calls.push(options); return Promise.resolve(); } }],
  ]);
  const pending = stop(schedulers, { error: text => errors.push(text) }, () => ({ cause: "safe_failure" })).then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(calls.length, 3); assert.ok(calls.every(options => options.abortActive)); assert.equal(settled, false);
  assert.deepEqual(errors, ["[pit] broken shutdown failed safely: cause=safe_failure"]);
  finish(); await pending; assert.equal(settled, true);
});
