import test from "node:test";
import assert from "node:assert/strict";

import { createRequestControl, resolveRequestTimeout } from "./requestControl.mjs";

test("request deadlines use bounded read/write defaults", () => {
  assert.equal(resolveRequestTimeout("GET"), 20_000);
  assert.equal(resolveRequestTimeout("POST"), 30_000);
  assert.equal(resolveRequestTimeout("PATCH", 2500), 2500);
  assert.equal(resolveRequestTimeout("GET", 999_999), 120_000);
  assert.equal(resolveRequestTimeout("GET", 0), 20_000);
});
test("request control distinguishes its timeout from caller cancellation", async () => {
  const deadline = createRequestControl({ method: "GET", timeoutMs: 5 });
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(deadline.signal.aborted, true);
  assert.equal(deadline.didTimeout(), true);
  deadline.cleanup();

  const caller = new AbortController();
  const cancelled = createRequestControl({ method: "POST", timeoutMs: 500, callerSignal: caller.signal });
  caller.abort();
  assert.equal(cancelled.signal.aborted, true);
  assert.equal(cancelled.didTimeout(), false);
  cancelled.cleanup();
});
