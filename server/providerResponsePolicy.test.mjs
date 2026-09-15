import assert from "node:assert/strict";
import test from "node:test";
import { discardProviderResponse, providerRetryAfterMs } from "./providerResponsePolicy.js";

test("Retry-After accepts seconds and dates with a finite one-hour bound", () => {
  const at = Date.UTC(2026, 8, 15, 12);
  const response = (value) => ({ headers: new Headers({ "Retry-After": value }) });
  assert.equal(providerRetryAfterMs(response("90"), at), 90_000);
  assert.equal(providerRetryAfterMs(response(new Date(at + 120_000).toUTCString()), at), 120_000);
  assert.equal(providerRetryAfterMs(response("999999999"), at), 3_600_000);
  assert.equal(providerRetryAfterMs(response("invalid"), at), null);
  assert.equal(providerRetryAfterMs({}), null);
});

test("failed response bodies are disposed without masking the provider error", async () => {
  let cancelled = 0;
  discardProviderResponse({ body: { cancel: () => { cancelled += 1; return Promise.reject(new Error("closed")); } } });
  discardProviderResponse({ body: { cancel: () => { throw new Error("already closed"); } } });
  discardProviderResponse({});
  await Promise.resolve();
  assert.equal(cancelled, 1);
});
