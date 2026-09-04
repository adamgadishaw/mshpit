import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { shouldRecordGeneralRequestFailure } from "./requestFailureObservability.js";

test("only the exact strict-readiness dependency response is excluded", () => {
  const strict = {
    method: "GET",
    route: "/api/readiness",
    status: 503,
    code: "MEDIA_STORAGE_UNAVAILABLE",
  };
  assert.equal(shouldRecordGeneralRequestFailure(strict), false);
  for (const variant of [
    { ...strict, method: "POST" },
    { ...strict, route: "/api/health" },
    { ...strict, status: 500 },
    { ...strict, code: "DATABASE_UNAVAILABLE" },
    { ...strict, route: "/api/media/assets/:id/finalize", method: "POST" },
  ]) assert.equal(shouldRecordGeneralRequestFailure(variant), true);
});

test("the HTTP boundary gates Render logging with the same exact exclusion", async () => {
  const source = await readFile(new URL("./index.js", import.meta.url), "utf8");
  const start = source.indexOf("const failure = safeRequestFailureContext");
  const end = source.indexOf("return sendApiError(res, e, requestId, cors);", start);
  assert.ok(start >= 0 && end > start, "the API failure boundary must remain inspectable");
  const boundary = source.slice(start, end);

  assert.match(boundary, /const observable = shouldRecordGeneralRequestFailure\(\{[\s\S]*?method: failure\.method,[\s\S]*?route: routePattern,[\s\S]*?status: e\.status,[\s\S]*?code: e\.code,[\s\S]*?\}\);/u);
  assert.match(boundary, /if \(observable\) \{\s*console\.error\([\s\S]*?recordError\([\s\S]*?scheduleAlert\(\);\s*\}/u,
    "only the known strict-readiness dependency response may skip console, storage, and alerting together");
});
