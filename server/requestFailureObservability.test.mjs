import assert from "node:assert/strict";
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
