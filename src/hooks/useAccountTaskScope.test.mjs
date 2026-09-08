import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import { createAccountTaskScope } from "../domain/accountTaskScope.mjs";

const source = readFileSync(new URL("./useAccountTaskScope.js", import.meta.url), "utf8");
const declaration = parse(source, { sourceType: "module" }).program.body
  .find((node) => node.type === "ExportNamedDeclaration")?.declaration;
assert.equal(declaration?.id?.name, "useAccountTaskScope");

function fixture() {
  const ref = { current: null }; let setup;
  const hook = new Function("useRef", "useEffect", "createAccountTaskScope", `return (${source.slice(declaration.start, declaration.end)});`)(
    () => ref, (effect) => { setup = effect; }, createAccountTaskScope,
  );
  return { hook, mount: () => setup() };
}

test("the real hook invalidates tasks during account render before effect cleanup", () => {
  const f = fixture(), scope = f.hook("a"), cleanup = f.mount(), old = scope.begin("a");
  f.hook("a"); assert.equal(old.isCurrent(), true, "same-account validation must keep the current upload");
  f.hook("b"); assert.equal(old.controller.signal.aborted, true);
  f.hook("a"); assert.equal(old.isCurrent(), false);
  const current = scope.begin("a"); cleanup(); assert.equal(current.isCurrent(), false);
});

test("the real hook survives development effect cleanup/setup without reviving old work", () => {
  const f = fixture(), scope = f.hook("a"), cleanup = f.mount(), old = scope.begin("a");
  cleanup(); f.mount();
  assert.equal(old.isCurrent(), false); assert.equal(scope.begin("a").isCurrent(), true);
});
