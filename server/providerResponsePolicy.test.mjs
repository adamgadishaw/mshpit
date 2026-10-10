import assert from "node:assert/strict";
import test from "node:test";
import { discardProviderResponse, providerRetryAfterMs, PROVIDER_RETRY_AFTER_MAX_MS, withProviderRetryDeadline } from "./providerResponsePolicy.js";

test("Retry-After accepts seconds and dates without shortening waits up to 24 hours", () => {
  const at = Date.UTC(2026, 8, 15, 12);
  const response = (value) => ({ headers: new Headers({ "Retry-After": value }) });
  assert.equal(providerRetryAfterMs(response("90"), at), 90_000);
  assert.equal(providerRetryAfterMs(response(new Date(at + 120_000).toUTCString()), at), 120_000);
  assert.equal(providerRetryAfterMs(response("7200"), at), 7_200_000);
  assert.equal(providerRetryAfterMs(response(new Date(at + 7_200_000).toUTCString()), at), 7_200_000);
  assert.equal(providerRetryAfterMs(response("86400"), at), PROVIDER_RETRY_AFTER_MAX_MS);
  assert.equal(providerRetryAfterMs(response("999999999"), at), PROVIDER_RETRY_AFTER_MAX_MS);
  assert.equal(providerRetryAfterMs(response("9".repeat(400)), at), PROVIDER_RETRY_AFTER_MAX_MS);
  assert.equal(providerRetryAfterMs(response(new Date(at + 2 * PROVIDER_RETRY_AFTER_MAX_MS).toUTCString()), at), PROVIDER_RETRY_AFTER_MAX_MS);
  assert.equal(providerRetryAfterMs(response("invalid"), at), null);
  assert.equal(providerRetryAfterMs({}), null);
});

test("Retry-After rejects malformed numeric values and keeps explicit expired hints at zero", () => {
  const at = Date.UTC(2026, 8, 15, 12);
  const response = (value) => ({ headers: new Headers({ "Retry-After": value }) });
  for (const value of ["", " ", "-1", "+2", "1.5", "1e3", "Infinity", "NaN", "0x10", "2026-09-15", "Mon, 2050"]) {
    assert.equal(providerRetryAfterMs(response(value), at), null, value);
  }
  assert.equal(providerRetryAfterMs(response("0"), at), 0);
  assert.equal(providerRetryAfterMs(response(new Date(at - 60_000).toUTCString()), at), 0);
  assert.equal(providerRetryAfterMs(response(" 00090 "), at), 90_000);
});

test("failed response bodies are disposed without masking the provider error", async () => {
  let cancelled = 0;
  discardProviderResponse({ body: { cancel: () => { cancelled += 1; return Promise.reject(new Error("closed")); } } });
  discardProviderResponse({ body: { cancel: () => { throw new Error("already closed"); } } });
  discardProviderResponse({});
  await Promise.resolve();
  assert.equal(cancelled, 1);
});

test("effective retry timing keeps mutable provider error identity and its semantic fields", () => {
  const cause = new Error("original cause");
  const error = Object.assign(new Error("upstream unavailable", { cause }), { provider: "MusicBrainz", status: 503, code: "upstream_5xx" });
  assert.equal(withProviderRetryDeadline(error, 90_000, 10_000), error);
  assert.equal(error.retryAt, 90_000);
  assert.equal(error.retryAfterMs, 80_000);
  assert.equal(error.cause, cause);
  assert.equal(error.provider, "MusicBrainz");
  assert.equal(error.status, 503);
  assert.equal(error.code, "upstream_5xx");
  assert.equal(withProviderRetryDeadline(error, 90_000, 20_000).retryAfterMs, 70_000);
  assert.equal(error.retryAt, 90_000, "replaying a deadline does not restart its wait");
});

test("frozen and nonextensible provider errors retain their prototype, cause, stack and text", () => {
  class ProviderFailure extends Error {
    constructor(cause) {
      super("provider refused the request", { cause });
      this.name = "ProviderFailure";
      this.provider = "MusicBrainz";
      this.status = 503;
      this.code = "upstream_5xx";
    }
  }
  for (const freeze of [Object.freeze, Object.preventExtensions]) {
    const cause = new Error("response failure");
    const error = new ProviderFailure(cause);
    const stack = error.stack;
    freeze(error);
    const annotated = withProviderRetryDeadline(error, 90_000, 10_000);
    assert.notEqual(annotated, error);
    assert.ok(annotated instanceof ProviderFailure);
    assert.equal(annotated.cause, cause);
    assert.equal(annotated.stack, stack);
    assert.equal(annotated.toString(), error.toString());
    assert.equal(annotated.provider, error.provider);
    assert.equal(annotated.status, error.status);
    assert.equal(annotated.code, error.code);
    assert.equal(annotated.retryAt, 90_000);
    assert.equal(annotated.retryAfterMs, 80_000);
  }
});

test("throwing retry setters cannot hide provider failures and primitive throws stay unchanged", () => {
  const error = Object.assign(new Error("provider response"), { status: 429, code: "rate_limited" });
  let setterCalls = 0;
  for (const name of ["retryAt", "retryAfterMs"]) {
    Object.defineProperty(error, name, { configurable: false, set() { setterCalls += 1; throw new Error("setter must not run"); } });
  }
  const annotated = withProviderRetryDeadline(error, 90_000, 10_000);
  assert.equal(setterCalls, 0);
  assert.equal(annotated.message, error.message);
  assert.equal(annotated.status, 429);
  assert.equal(annotated.code, "rate_limited");
  assert.equal(annotated.retryAfterMs, 80_000);
  for (const primitive of [null, undefined, "upstream failure", 0, false]) {
    assert.equal(withProviderRetryDeadline(primitive, 90_000, 10_000), primitive);
  }
  assert.equal(withProviderRetryDeadline(error, NaN, 10_000), error);
  assert.equal(withProviderRetryDeadline(new Error("huge"), Number.MAX_SAFE_INTEGER, 10_000).retryAt, 10_000 + PROVIDER_RETRY_AFTER_MAX_MS);
});
