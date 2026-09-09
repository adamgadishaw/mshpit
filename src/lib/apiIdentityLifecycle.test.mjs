import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import { apiIdentityBarrierDecision } from "../domain/apiIdentityState.mjs";
import { createRequestControl } from "./requestControl.mjs";

// Execute the actual client transport with isolated fetch/platform seams. No
// server, cookies, user data, or React Native runtime is used by these tests.
const source = readFileSync(new URL("./api.js", import.meta.url), "utf8");
const ast = parse(source, { sourceType: "module" });
const body = ast.program.body.flatMap((node) => {
  if (node.type === "ImportDeclaration" || (node.type === "ExportNamedDeclaration" && !node.declaration)) return [];
  const declaration = node.type === "ExportNamedDeclaration" ? node.declaration : node;
  return [source.slice(declaration.start, declaration.end)];
}).join("\n");
const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
};

function fixture() {
  const response = deferred(), requests = [], diagnostics = [];
  const bindings = {
    Platform: { OS: "test" }, apiBaseForRuntime: () => "http://fixture.invalid",
    AppError: class extends Error { constructor(message, options = {}) { super(message); Object.assign(this, options); } },
    captureAppError: (error) => { diagnostics.push(error); return error; },
    apiIdentityBarrierDecision, createRequestControl, photoCreditUrlFromLinkHeader: () => null,
    fetch: async (url, options) => { requests.push({ url, options }); return response.promise; },
  };
  const transport = new Function(...Object.keys(bindings), `${body}\nreturn { api, apiBinary, configureApiIdentity };`)(...Object.values(bindings));
  transport.configureApiIdentity("a");
  return {
    ...transport, requests, diagnostics,
    finish: (binary = false) => response.resolve(new Response(binary ? new Uint8Array([137, 80, 78, 71]) : JSON.stringify({ private: "account-a" }), {
      status: 200, headers: { "Content-Type": binary ? "image/png" : "application/json" },
    })),
  };
}

for (const binary of [false, true]) {
  for (const transition of ["logout", "switch", "roundtrip", "revalidation"]) {
    test(`${binary ? "binary" : "JSON"} explicit account response is fenced after ${transition}`, async () => {
      const f = fixture();
      const pending = (binary ? f.apiBinary : f.api)("/api/private-fixture", { expectedAccountId: "a", silent: true });
      assert.equal(f.requests[0].options.headers["X-Pit-Expected-Account"], "a");
      if (transition === "logout") f.configureApiIdentity(null);
      if (transition === "switch" || transition === "roundtrip") f.configureApiIdentity("b");
      if (transition === "roundtrip") f.configureApiIdentity("a");
      if (transition === "revalidation") f.configureApiIdentity("a", { ready: false });
      const rejected = assert.rejects(pending, { status: 409, serverCode: "IDENTITY_CHANGED" });
      f.finish(binary);
      await rejected;
    });
  }
  test(`${binary ? "binary" : "JSON"} explicit current account succeeds`, async () => {
    const f = fixture();
    const pending = (binary ? f.apiBinary : f.api)("/api/private-fixture", { expectedAccountId: "a" });
    f.finish(binary);
    const result = await pending;
    assert.ok(binary ? result.bytes.length : result.private === "account-a");
    assert.equal(f.diagnostics.length, 0);
  });
}

test("deliberate identity discovery remains available across identity changes", async () => {
  const f = fixture();
  const pending = f.api("/api/me", { skipIdentityCheck: true });
  f.configureApiIdentity("b");
  f.finish();
  assert.deepEqual(await pending, { private: "account-a" });
  assert.equal(f.requests[0].options.headers["X-Pit-Expected-Account"], undefined);
});
