import test from "node:test";
import assert from "node:assert/strict";

import {
  ERROR_CATALOG,
  catalogEntry,
  catalogueCode,
  safeRouteTemplate,
} from "./errorCatalog.mjs";

test("every public error has a stable code and complete support copy", () => {
  for (const [code, entry] of Object.entries(ERROR_CATALOG)) {
    assert.match(code, /^PIT-[A-Z]+-\d{3}$/);
    assert.ok(entry.category);
    assert.match(entry.severity, /^(warning|error|fatal|info)$/);
    assert.ok(entry.title.length >= 8);
    assert.ok(entry.message.length >= 20);
    assert.ok(entry.failurePoint);
    assert.ok(entry.guidance);
    assert.equal(typeof entry.retryable, "boolean");
  }
});

test("server failure codes normalize to stable PIT references", () => {
  const expected = {
    AUTH_REQUIRED: "PIT-AUTH-001",
    AUTH_INVALID: "PIT-AUTH-003",
    FORBIDDEN: "PIT-AUTH-002",
    VALIDATION_FAILED: "PIT-REQ-001",
    NOT_FOUND: "PIT-REQ-002",
    CONFLICT: "PIT-REQ-003",
    RATE_LIMITED: "PIT-RATE-001",
    MEDIA_STORAGE_UNAVAILABLE: "PIT-UPLOAD-001",
    MEDIA_TYPE_UNSUPPORTED: "PIT-UPLOAD-002",
    MEDIA_TOO_LARGE: "PIT-UPLOAD-003",
    MEDIA_UPLOAD_FAILED: "PIT-UPLOAD-004",
    PROVIDER_UNAVAILABLE: "PIT-SVC-002",
    INTERNAL_ERROR: "PIT-SVC-001",
  };
  for (const [serverCode, pitCode] of Object.entries(expected)) {
    assert.equal(catalogueCode({ serverCode, status: 500 }), pitCode);
  }
});

test("network, response, and HTTP failures normalize predictably", () => {
  assert.equal(catalogueCode({ kind: "network" }), "PIT-NET-001");
  assert.equal(catalogueCode({ kind: "abort" }), "PIT-NET-002");
  assert.equal(catalogueCode({ kind: "invalid_response", status: 200 }), "PIT-API-001");
  assert.equal(catalogueCode({ status: 408 }), "PIT-NET-002");
  assert.equal(catalogueCode({ status: 429 }), "PIT-RATE-001");
  assert.equal(catalogueCode({ status: 503 }), "PIT-SVC-001");
  assert.equal(catalogueCode({}), "PIT-UNK-001");
  assert.equal(catalogEntry("not-a-code"), ERROR_CATALOG["PIT-UNK-001"]);
});

test("diagnostic routes discard query values and private identifiers", () => {
  assert.equal(
    safeRouteTemplate("/api/youtube/track?title=Private%20Song&artist=Someone"),
    "/api/youtube/track",
  );
  assert.equal(safeRouteTemplate("/api/users/user-secret-123/followers"), "/api/users/:id/followers");
  assert.equal(safeRouteTemplate("/api/posts/998812/comments?token=secret"), "/api/posts/:id/comments");
});
