import assert from "node:assert/strict";
import test from "node:test";

import { ApiError, errorEnvelope } from "./errors.js";
import { mediaStorageRequestFailure, requestMediaStorage } from "./mediaStorageRequest.js";
import { safeRequestFailureContext } from "./safeLogging.js";

const URL = "https://storage.example.test/private/object?signature=private-secret";
const networkError = (code = "ECONNRESET") => new TypeError(`fetch failed ${URL}`, {
  cause: Object.assign(new Error("private-account-id"), { code }),
});
const immediate = async () => {};
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flushLateCompletion = () => new Promise((resolve) => setImmediate(resolve));

test("storage HEAD retries a transient network failure with the same original signal and URL", async () => {
  const controller = new AbortController();
  const attempts = [];
  const waits = [];
  const expected = { status: 200 };
  const result = await requestMediaStorage({
    url: URL, method: "HEAD", stage: "head", signal: controller.signal,
    fetchImpl: async (url, options) => {
      attempts.push({ url, options });
      if (attempts.length < 3) throw networkError();
      return expected;
    },
    waitImpl: async (ms, options) => { waits.push(ms); assert.equal(options.signal, controller.signal); },
  });
  assert.equal(result, expected);
  assert.deepEqual(waits, [150, 350]);
  assert.equal(attempts.length, 3);
  for (const { url, options } of attempts) {
    assert.equal(url, URL);
    assert.equal(options.signal, controller.signal);
    assert.equal(options.redirect, "error");
    assert.equal(options.method, "HEAD");
  }
});

test("storage retry statuses are bounded and discard failed response bodies", async () => {
  for (const status of [408, 429, 500, 502, 503, 504]) {
    let calls = 0;
    let cancelled = 0;
    await assert.rejects(requestMediaStorage({
      url: URL, method: "GET", stage: "digest_get", waitImpl: immediate,
      fetchImpl: async () => {
        calls += 1;
        return { status, body: { cancel: async () => { cancelled += 1; } } };
      },
    }), { name: "MediaStorageRequest", code: `digest_get_http_${status}` });
    assert.equal(calls, 3);
    assert.equal(cancelled, 3);
  }
});

test("storage does not retry access, missing-object, generation or other non-transient statuses", async () => {
  for (const status of [301, 400, 401, 403, 404, 409, 412, 415, 501]) {
    let calls = 0;
    const response = await requestMediaStorage({
      url: URL, method: "HEAD", stage: "head", waitImpl: immediate,
      fetchImpl: async () => { calls += 1; return { status }; },
    });
    assert.equal(response.status, status);
    assert.equal(calls, 1);
  }
});

test("a short Retry-After is honored and a long one returns without retrying early", async () => {
  const waits = [];
  let calls = 0;
  await requestMediaStorage({
    url: URL, method: "HEAD", stage: "head",
    fetchImpl: async () => ++calls === 1
      ? { status: 429, headers: new Headers({ "retry-after": "1" }) } : { status: 200 },
    waitImpl: async (ms) => { waits.push(ms); },
  });
  assert.deepEqual(waits, [1_000]);
  calls = 0;
  await assert.rejects(requestMediaStorage({
    url: URL, method: "HEAD", stage: "head", waitImpl: immediate,
    fetchImpl: async () => { calls += 1; return { status: 503, headers: new Headers({ "retry-after": "120" }) }; },
  }), { code: "head_http_503" });
  assert.equal(calls, 1);
});

test("storage cancellation before fetch and during a retry delay never starts another attempt", async () => {
  const before = AbortSignal.abort();
  let calls = 0;
  await assert.rejects(requestMediaStorage({
    url: URL, method: "HEAD", stage: "head", signal: before,
    fetchImpl: async () => { calls += 1; },
  }), { code: "head_cancelled" });
  assert.equal(calls, 0);

  const controller = new AbortController();
  await assert.rejects(requestMediaStorage({
    url: URL, method: "HEAD", stage: "head", signal: controller.signal,
    fetchImpl: async () => { calls += 1; throw networkError(); },
    waitImpl: async () => { controller.abort(); },
  }), { code: "head_cancelled" });
  assert.equal(calls, 1);
});

test("the original deadline also bounds the actual retry timer", async () => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new DOMException("private detail", "TimeoutError")), 15);
  let calls = 0;
  try {
    await assert.rejects(requestMediaStorage({
      url: URL, method: "HEAD", stage: "head", signal: controller.signal,
      fetchImpl: async () => { calls += 1; throw networkError(); },
    }), { code: "head_timeout" });
    assert.equal(calls, 1);
  } finally { clearTimeout(timeout); }
});

test("a failed body read restarts a fresh generation-bound GET consumer", async () => {
  let attempts = 0;
  const seen = [];
  const output = await requestMediaStorage({
    url: URL, method: "GET", stage: "source_get", headers: { "if-match": '"generation-one"' },
    waitImpl: immediate,
    fetchImpl: async (url, options) => {
      seen.push({ url, headers: options.headers });
      attempts += 1;
      return { status: 200, attempt: attempts };
    },
    consume: async (response) => {
      const chunks = ["first"];
      if (response.attempt === 1) throw networkError("UND_ERR_SOCKET");
      chunks.push("second");
      return chunks;
    },
  });
  assert.deepEqual(output, ["first", "second"]);
  assert.equal(seen.length, 2);
  assert.deepEqual(seen[0], seen[1]);
});

test("generation, validation and authority errors from consumers are never retried or replaced", async () => {
  for (const error of [new ApiError(409, "Changed", "CONFLICT"), new ApiError(401, "Log in", "AUTH_REQUIRED")]) {
    let calls = 0;
    await assert.rejects(requestMediaStorage({
      url: URL, method: "GET", stage: "source_get", waitImpl: immediate,
      fetchImpl: async () => { calls += 1; return { status: 200 }; },
      consume: async () => { throw error; },
    }), (actual) => actual === error);
    assert.equal(calls, 1);
  }
});

test("storage errors retain only finite stage and network buckets in private telemetry", async () => {
  for (const [input, expected] of [
    [networkError(), "connection"], [networkError("EAI_AGAIN"), "dns"],
    [networkError("UND_ERR_HEADERS_TIMEOUT"), "timeout"],
    [new TypeError(URL), "network"], [Object.assign(new Error(URL), { code: URL }), "other"],
    [Object.assign(new Error(URL), { name: "AbortError" }), "cancelled"],
  ]) {
    const failure = mediaStorageRequestFailure({ stage: "photo_put", error: input });
    assert.equal(failure.code, `photo_put_${expected}`);
    assert.equal(failure.cause, undefined);
    const wrapped = new ApiError(503, "Storage is temporarily unavailable.", "MEDIA_STORAGE_UNAVAILABLE", failure);
    assert.equal(safeRequestFailureContext({ error: wrapped }).cause, `MediaStorageRequest/photo_put_${expected}`);
    assert.doesNotMatch(JSON.stringify({ failure, public: errorEnvelope(wrapped, "request-id") }), /private|signature|storage\.example/);
    assert.equal(errorEnvelope(wrapped, "request-id").cause, undefined);
  }
  assert.throws(() => mediaStorageRequestFailure({ stage: URL, error: networkError() }), TypeError);
});

test("unknown non-network exceptions are not retried and conditional writes cannot enter the read helper", async () => {
  let calls = 0;
  await assert.rejects(requestMediaStorage({
    url: URL, method: "HEAD", stage: "head", waitImpl: immediate,
    fetchImpl: async () => { calls += 1; throw new Error(URL); },
  }), { code: "head_other" });
  assert.equal(calls, 1);
  for (const method of ["PUT", "POST", "DELETE"]) {
    await assert.rejects(requestMediaStorage({
      url: URL, method, stage: "head", fetchImpl: async () => { calls += 1; },
    }), TypeError);
  }
  assert.equal(calls, 1);
});

test("a fetch ignoring its signal still releases the caller at the original deadline and disposes its late response", { timeout: 1_000 }, async () => {
  const pending = deferred();
  const started = deferred();
  const controller = new AbortController();
  let calls = 0;
  let cancelled = 0;
  const result = requestMediaStorage({
    url: URL, method: "HEAD", stage: "head", signal: controller.signal,
    fetchImpl: () => { calls += 1; started.resolve(); return pending.promise; },
  });
  await started.promise;
  controller.abort(new DOMException("original edge deadline", "TimeoutError"));
  await assert.rejects(result, { name: "MediaStorageRequest", code: "head_timeout" });
  assert.equal(calls, 1);
  pending.resolve({ status: 200, body: { cancel: async () => { cancelled += 1; } } });
  await flushLateCompletion();
  assert.equal(cancelled, 1, "the late success is discarded, not adopted");
  assert.equal(calls, 1, "deadline expiry must not retry");
});

test("an aborted non-cooperative fetch may reject late without an unhandled rejection or another attempt", { timeout: 1_000 }, async () => {
  const pending = deferred();
  const started = deferred();
  const controller = new AbortController();
  let calls = 0;
  const result = requestMediaStorage({
    url: URL, method: "GET", stage: "source_get", signal: controller.signal,
    fetchImpl: () => { calls += 1; started.resolve(); return pending.promise; },
  });
  await started.promise;
  controller.abort();
  await assert.rejects(result, { code: "source_get_cancelled" });
  pending.reject(networkError());
  await flushLateCompletion();
  assert.equal(calls, 1);
});

test("a hanging locked GET body cannot retain the caller after abort and is discarded after late completion", { timeout: 1_000 }, async () => {
  const controller = new AbortController();
  const started = deferred();
  let streamController;
  const body = new ReadableStream({ start(value) { streamController = value; } });
  const originalCancel = body.cancel.bind(body);
  let cleanupAttempts = 0;
  body.cancel = (...args) => { cleanupAttempts += 1; return originalCancel(...args); };
  const result = requestMediaStorage({
    url: URL, method: "GET", stage: "digest_get", signal: controller.signal,
    fetchImpl: async () => ({ status: 200, body }),
    consume: async (response) => {
      const reader = response.body.getReader();
      started.resolve();
      try { await reader.read(); return "late success must not be adopted"; }
      finally { reader.releaseLock(); }
    },
  });
  await started.promise;
  controller.abort();
  await assert.rejects(result, { code: "digest_get_cancelled" });
  assert.equal(cleanupAttempts, 1, "cleanup is attempted immediately even if the consumer still owns the lock");
  streamController.close();
  await flushLateCompletion();
  assert.equal(body.locked, false);
  assert.equal(cleanupAttempts, 2, "late consumer settlement retries disposal after its lock is released");
});

test("a hanging GET consumer's late rejection is observed and cannot retry after deadline", { timeout: 1_000 }, async () => {
  const controller = new AbortController();
  const pending = deferred();
  const started = deferred();
  let calls = 0;
  let cancelled = 0;
  const result = requestMediaStorage({
    url: URL, method: "GET", stage: "source_get", signal: controller.signal,
    fetchImpl: async () => { calls += 1; return { status: 200, body: { cancel: async () => { cancelled += 1; } } }; },
    consume: () => { started.resolve(); return pending.promise; },
  });
  await started.promise;
  controller.abort(new DOMException("deadline", "TimeoutError"));
  await assert.rejects(result, { code: "source_get_timeout" });
  pending.reject(networkError());
  await flushLateCompletion();
  assert.equal(calls, 1);
  assert.equal(cancelled, 2);
});
