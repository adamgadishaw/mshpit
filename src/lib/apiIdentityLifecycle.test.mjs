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
  const transport = new Function(...Object.keys(bindings), `${body}\nreturn { api, apiBinary, configureApiIdentity, waiting: () => identityWaiters.size };`)(...Object.values(bindings));
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

test("cold identity admission bounds mixed JSON and binary continuations", async () => {
  const f = fixture();
  f.configureApiIdentity(null, { ready: false });
  const controllers = Array.from({ length: 128 }, () => new AbortController());
  const pending = controllers.map((controller, index) => (
    index % 2 ? f.apiBinary : f.api
  )("/api/private-fixture", {
    signal: controller.signal,
    silent: true,
  }).then(() => null, (error) => error));

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.waiting(), 128);
  const overflow = await f.api("/api/private-fixture", { silent: true })
    .then(() => null, (error) => error);
  assert.equal(overflow?.status, 503);
  assert.equal(overflow?.serverCode, "IDENTITY_BARRIER_BUSY");
  assert.equal(overflow?.retryable, true);
  assert.equal(f.requests.length, 0, "overflow never becomes a cookie-authenticated request");

  for (const controller of controllers) controller.abort();
  await Promise.all(pending);
  assert.equal(f.waiting(), 0, "cancelling the admitted work releases every slot");
});

test("deliberate identity discovery remains available across identity changes", async () => {
  const f = fixture();
  const pending = f.api("/api/me", { skipIdentityCheck: true });
  f.configureApiIdentity("b");
  f.finish();
  assert.deepEqual(await pending, { private: "account-a" });
  assert.equal(f.requests[0].options.headers["X-Pit-Expected-Account"], undefined);
});

for (const binary of [false, true]) {
  const label = binary ? "binary" : "JSON";
  test(`${label} cold-start identity wait obeys the request deadline`, async () => {
    const f = fixture(), caller = new AbortController();
    f.configureApiIdentity(null, { ready: false });
    const pending = (binary ? f.apiBinary : f.api)("/api/private-fixture", {
      timeoutMs: 10, signal: caller.signal, silent: true,
    }).then(() => null, (error) => error);
    const result = await Promise.race([pending, new Promise((resolve) => setTimeout(() => resolve("still waiting"), 100))]);
    caller.abort();
    await pending;
    assert.equal(result?.kind, "timeout");
    assert.equal(f.requests.length, 0, "no cookie-bound request may escape the unvalidated gate");
    assert.equal(f.diagnostics.length, 1);
    assert.equal(f.waiting(), 0, "deadline removes the pending identity waiter");
    f.configureApiIdentity("b");
    await Promise.resolve();
    assert.equal(f.requests.length, 0, "timed-out requests are never replayed on later validation");
  });

  test(`${label} cold-start wait survives replacement by another unready identity`, async () => {
    const f = fixture(), caller = new AbortController();
    f.configureApiIdentity(null, { ready: false });
    const pending = (binary ? f.apiBinary : f.api)("/api/private-fixture", { signal: caller.signal })
      .then((value) => value, (error) => error);
    f.configureApiIdentity("b", { ready: false });
    f.configureApiIdentity("b");
    await new Promise((resolve) => setTimeout(resolve, 10));
    const request = f.requests[0];
    f.finish(binary);
    caller.abort();
    await pending;
    assert.equal(request?.options.headers["X-Pit-Expected-Account"], "b");
  });

  test(`${label} a briefly ready identity cannot release a now-unvalidated request`, async () => {
    const f = fixture(), caller = new AbortController();
    f.configureApiIdentity(null, { ready: false });
    const pending = (binary ? f.apiBinary : f.api)("/api/private-fixture", { signal: caller.signal })
      .then((value) => value, (error) => error);
    f.configureApiIdentity("b");
    f.configureApiIdentity("b", { ready: false });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const escaped = f.requests.length;
    f.configureApiIdentity("b");
    f.finish(binary);
    await pending;
    assert.equal(escaped, 0);
    assert.equal(f.requests[0].options.headers["X-Pit-Expected-Account"], "b");
  });

  test(`${label} cancellation while waiting stays out of error diagnostics`, async () => {
    const f = fixture(), caller = new AbortController();
    f.configureApiIdentity(null, { ready: false });
    const pending = (binary ? f.apiBinary : f.api)("/api/private-fixture", { signal: caller.signal });
    caller.abort();
    await assert.rejects(pending, { name: "AbortError" });
    assert.equal(f.requests.length, 0);
    assert.equal(f.diagnostics.length, 0);
    assert.equal(f.waiting(), 0, "cancellation removes the pending identity waiter");
  });

  test(`${label} identity invalidation between helper completion and dispatch cannot release a request`, async () => {
    const f = fixture();
    f.configureApiIdentity(null, { ready: false });
    const pending = (binary ? f.apiBinary : f.api)("/api/private-fixture", { silent: true })
      .then((value) => value, (error) => error);
    f.configureApiIdentity("b");
    // The helper resumes first, then this invalidation runs before the caller
    // of the async helper can resume and construct cookie-bound headers.
    queueMicrotask(() => f.configureApiIdentity("b", { ready: false }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    const escaped = f.requests.length;
    f.configureApiIdentity("b");
    f.finish(binary);
    await pending;
    assert.equal(escaped, 0, "dispatch must validate readiness after every asynchronous boundary");
    assert.equal(f.requests[0].options.headers["X-Pit-Expected-Account"], "b");
  });
}
