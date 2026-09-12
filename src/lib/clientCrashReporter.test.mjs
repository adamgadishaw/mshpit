import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith("/src/lib/clientCrashReporter.js")) {
      if (specifier === "react-native") return { shortCircuit: true, url: "data:text/javascript,export const Platform={OS:'web'}" };
      if (specifier === "./api") return { shortCircuit: true, url: "data:text/javascript,export const apiUrl=(path)=>path" };
    }
    return nextResolve(specifier, context);
  },
});
const { configureClientCrashSurface, reportClientCrash, resetClientCrashReporterForTests } = await import("./clientCrashReporter.js");
hooks.deregister();

const origin = "https://app.example";
const asset = "index-0123456789abcdef0123456789abcdef.js";
const requestId = "123e4567-e89b-42d3-a456-426614174000";
function setup(t, fetch) {
  resetClientCrashReporterForTests();
  for (const [key, value] of Object.entries({ window: { location: { origin, pathname: "/" } }, __DEV__: false })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => original ? Object.defineProperty(globalThis, key, original) : delete globalThis[key]);
  }
  return t.mock.method(globalThis, "fetch", fetch);
}
function crash(ErrorType = TypeError, line = 1) {
  const error = new ErrorType(`Cannot read 'photos' of "Jane's private note" for jane@example.com`);
  error.stack = `${error.name}: ${error.message}\n    at privateFunction (${origin}/_expo/static/js/web/${asset}:${line}:123)`;
  return error;
}

test("reports send only projected diagnostics, omit credentials and return matching support receipts", async (t) => {
  const fetch = setup(t, async () => new Response(null, { status: 200, headers: { "X-Request-Id": requestId } }));
  assert.deepEqual(await reportClientCrash({ kind: "render", error: crash() }), { requestId });
  const [url, options] = fetch.mock.calls[0].arguments;
  assert.equal(url, "/api/client-errors");
  assert.equal(options.credentials, "omit");
  assert.equal(options.referrerPolicy, "no-referrer");
  assert.equal(options.keepalive, true);
  assert.deepEqual(JSON.parse(options.body), {
    kind: "render", platform: "web", surface: "landing", errorType: "TypeError", diagnosis: "type",
    location: { asset, line: 1, column: 123 },
    message: `Cannot read 'photos' of "<text>" for <email>`,
  });
  // The message travels redacted; the stack, function names and page origin never do.
  for (const leaked of ["Jane", "jane@example.com", "privateFunction", origin]) {
    assert.equal(options.body.includes(leaked), false, `${leaked} must not be transmitted`);
  }
  assert.equal(options.signal.aborted, false);
});

test("deduplication distinguishes safe error classes and compiled locations, not private text", async (t) => {
  const fetch = setup(t, async () => new Response(null, { status: 200 }));
  await reportClientCrash({ kind: "render", error: crash() });
  const same = crash();
  same.message = "different private content";
  assert.equal(await reportClientCrash({ kind: "render", error: same }), false);
  await reportClientCrash({ kind: "render", error: crash(ReferenceError) });
  await reportClientCrash({ kind: "render", error: crash(TypeError, 2) });
  assert.equal(fetch.mock.callCount(), 3);
});

test("legacy reports remain safe and invalid request references are discarded", async (t) => {
  const fetch = setup(t, async () => new Response(null, { status: 200, headers: { "X-Request-Id": "private" } }));
  assert.deepEqual(await reportClientCrash({ kind: "render" }), { requestId: null });
  assert.deepEqual(JSON.parse(fetch.mock.calls[0].arguments[1].body), { kind: "render", platform: "web", surface: "landing" });
});

test("active SPA navigation overrides the root URL without exposing screen parameters", async (t) => {
  const fetch = setup(t, async () => new Response(null, { status: 200 }));
  assert.equal(configureClientCrashSurface("tab_you"), "you");
  await reportClientCrash({ kind: "render", error: crash() });
  assert.equal(JSON.parse(fetch.mock.calls[0].arguments[1].body).surface, "you");

  resetClientCrashReporterForTests();
  assert.equal(configureClientCrashSurface("profile:@private-person"), "app");
  await reportClientCrash({ kind: "runtime", error: crash(ReferenceError, 3) });
  assert.equal(JSON.parse(fetch.mock.calls[1].arguments[1].body).surface, "app");
});

test("report transport finishes after its deadline even if fetch ignores cancellation", async (t) => {
  const fetch = setup(t, () => new Promise(() => {}));
  const timers = t.mock.method(globalThis, "setTimeout", (callback) => { queueMicrotask(callback); return 1; });
  t.mock.method(globalThis, "clearTimeout", () => {});
  assert.equal(await reportClientCrash({ kind: "render", error: crash() }), false);
  assert.equal(timers.mock.calls[0].arguments[1], 5_000);
  assert.equal(fetch.mock.calls[0].arguments[1].signal.aborted, true);
});

test("network failures and development reports never recursively report", async (t) => {
  const fetch = setup(t, async () => { throw new Error("offline"); });
  assert.equal(await reportClientCrash({ kind: "runtime", error: crash() }), false);
  globalThis.__DEV__ = true;
  assert.equal(await reportClientCrash({ kind: "render", error: crash() }), false);
  assert.equal(fetch.mock.callCount(), 1);
});
