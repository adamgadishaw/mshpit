import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const require = createRequire(import.meta.url);
const { parse } = require("@babel/parser");
const bodyFor = (relative) => {
  const source = readFileSync(new URL(relative, root), "utf8");
  return parse(source, { sourceType: "module" }).program.body.flatMap((node) => {
    if (node.type === "ImportDeclaration" || (node.type === "ExportNamedDeclaration" && !node.declaration)) return [];
    const declaration = node.type === "ExportNamedDeclaration" ? node.declaration : node;
    return [source.slice(declaration.start, declaration.end)];
  }).join("\n");
};
const localImport = (relative) => import(new URL(relative, root));
const [catalog, privacy, deviceStorage, identity, control, retryAfter] = await Promise.all([
  localImport("src/lib/errorCatalog.mjs"), localImport("src/domain/accountLocalPrivacy.mjs"),
  localImport("src/domain/deviceStoragePolicy.mjs"), localImport("src/domain/apiIdentityState.mjs"),
  localImport("src/lib/requestControl.mjs"), localImport("src/lib/retryAfter.mjs"),
]);
const diagnosticsBody = bodyFor("src/lib/diagnostics.js");
const transportBody = bodyFor("src/lib/api.js");
const settle = () => new Promise((resolve) => setImmediate(resolve));

// Run both production modules together. Only fetch, platform and persistence
// are replaced; account history projection, AppError and feedback are real.
function fixture() {
  const storage = new Map(), feedback = [], requests = [];
  const persistence = {
    load: (key, fallback) => storage.has(key) ? structuredClone(storage.get(key)) : fallback,
    save: (key, value) => storage.set(key, structuredClone(value)),
    remove: (key) => storage.delete(key), setPersistErrorHandler() {},
  };
  const diagnosticBindings = { ...persistence, ...catalog, ...privacy, ...deviceStorage };
  const diagnostics = new Function(...Object.keys(diagnosticBindings), `${diagnosticsBody}\nreturn { AppError, captureAppError, configureDiagnosticsIdentity, getDiagnostics, subscribeFeedback };`)(...Object.values(diagnosticBindings));
  diagnostics.subscribeFeedback((entry) => feedback.push(entry));
  let resolve, reject;
  const response = new Promise((done, fail) => { resolve = done; reject = fail; });
  const bindings = {
    ...diagnostics, ...identity, ...control, ...retryAfter,
    Platform: { OS: "test" }, apiBaseForRuntime: () => "http://fixture.invalid",
    reviewAllowsRequest: () => true, photoCreditUrlFromLinkHeader: () => null,
    fetch: async (url, options) => { requests.push({ url, options }); return response; },
  };
  const transport = new Function(...Object.keys(bindings), `${transportBody}\nreturn { api, apiBinary, configureApiIdentity };`)(...Object.values(bindings));
  const adopt = (id) => { transport.configureApiIdentity(id); diagnostics.configureDiagnosticsIdentity(id); };
  const fail = (mode) => {
    if (mode === "network") { reject(new TypeError("Fixture transport failed")); return; }
    if (mode === "body") {
      resolve({ ok: false, status: 503, headers: new Headers(), text: async () => { throw new TypeError("Fixture body failed"); } });
      return;
    }
    const status = mode === "4xx" ? 403 : 503;
    resolve(new Response(JSON.stringify({ error: "Fixture failure", code: status === 403 ? "FORBIDDEN" : "SERVICE_UNAVAILABLE" }), {
      status, headers: { "Content-Type": "application/json", "x-request-id": "synthetic-a-request" },
    }));
  };
  return { ...transport, ...diagnostics, ...persistence, storage, feedback, requests, adopt, fail, respond: resolve };
}

for (const binary of [false, true]) {
  for (const mode of ["4xx", "5xx", "network", "body"]) {
    for (const transition of ["current", "switch", "roundtrip"]) {
      for (const silent of [false, true]) {
        test(`${binary ? "binary" : "JSON"} ${mode} failure respects ${transition} diagnostic ownership (silent=${silent})`, async () => {
          const f = fixture(); f.adopt("a");
          const pending = (binary ? f.apiBinary : f.api)("/api/posts/p_fixture/comments", {
            method: "POST", body: { text: "synthetic only" }, expectedAccountId: "a", silent,
          }).catch((error) => error);
          assert.equal(f.requests[0].options.headers["X-Pit-Expected-Account"], "a");
          if (transition !== "current") { f.adopt("b"); f.remove(privacy.diagnosticsStorageKey("a")); }
          if (transition === "roundtrip") f.adopt("a");
          f.fail(mode);
          const error = await pending;
          assert.ok(error instanceof Error, "the original request must still reject");
          assert.equal(error.status, mode === "4xx" ? 403 : mode === "5xx" || mode === "body" ? 503 : 0);
          const expected = transition === "current" ? 1 : 0;
          assert.equal(f.getDiagnostics().length, expected);
          assert.equal(f.feedback.length, expected && !silent ? 1 : 0);
          assert.equal(f.load(privacy.diagnosticsStorageKey("a"), []).length, expected);
          assert.deepEqual(f.load(privacy.diagnosticsStorageKey("b"), []), []);
        });
      }
    }
  }
  test(`${binary ? "binary" : "JSON"} cold identity waiting binds diagnostics to the dispatched owner`, async () => {
    const f = fixture();
    f.configureApiIdentity(null, { ready: false });
    const pending = (binary ? f.apiBinary : f.api)("/api/posts/p_fixture/comments", { method: "POST" }).catch((error) => error);
    f.adopt("a"); await settle();
    f.fail("5xx"); await pending;
    assert.equal(f.requests[0].options.headers["X-Pit-Expected-Account"], "a");
    assert.equal(f.getDiagnostics().length, 1);
    assert.equal(f.load(privacy.diagnosticsStorageKey("a"), []).length, 1);
    assert.equal(f.feedback.length, 1);
  });
  test(`${binary ? "binary" : "JSON"} rejected stale success creates no new-owner feedback`, async () => {
    const f = fixture(); f.adopt("a");
    const pending = (binary ? f.apiBinary : f.api)("/api/posts/p_fixture/comments", { method: "POST", expectedAccountId: "a" }).catch((error) => error);
    f.adopt("b");
    f.respond(new Response(binary ? new Uint8Array([137, 80, 78, 71]) : JSON.stringify({ ok: true }), {
      status: 200, headers: { "Content-Type": binary ? "image/png" : "application/json" },
    }));
    const error = await pending;
    assert.equal(error.serverCode, "IDENTITY_CHANGED");
    assert.equal(f.getDiagnostics().length, 0);
    assert.equal(f.feedback.length, 0);
  });
  test(`${binary ? "binary" : "JSON"} owning services cannot recapture a retired request for another account`, async () => {
    const f = fixture(); f.adopt("a");
    const pending = (binary ? f.apiBinary : f.api)("/api/me/going", { expectedAccountId: "a" }).catch((error) => error);
    f.adopt("b"); f.fail("4xx");
    const error = await pending;
    // Attendance hydration, export and media services can add context after
    // an API failure. Their capture must respect its retired-request fence.
    for (const cause of [error, new f.AppError(undefined, { cause: error }), new Error("Service failure", { cause: new Error("Inner failure", { cause: error }) })]) {
      const captured = f.captureAppError(cause, { context: "Loading private show plans after sign-in", toast: true });
      assert.equal(captured.diagnosticSuppressed, true);
      f.captureAppError(captured, { toast: true, force: true });
    }
    assert.equal(f.getDiagnostics().length, 0);
    assert.equal(f.feedback.length, 0);
    assert.deepEqual(f.load(privacy.diagnosticsStorageKey("b"), []), []);
  });
  for (const transition of ["current", "switch"]) {
    test(`${binary ? "binary" : "JSON"} deliberate identity-discovery failure respects ${transition} ownership`, async () => {
      const f = fixture(); f.adopt("a");
      const pending = (binary ? f.apiBinary : f.api)("/api/me", { skipIdentityCheck: true, silent: true }).catch((error) => error);
      if (transition === "switch") f.adopt("b");
      f.fail("5xx"); await pending;
      assert.equal(f.getDiagnostics().length, transition === "current" ? 1 : 0);
      assert.equal(f.feedback.length, 0);
    });
  }
}
