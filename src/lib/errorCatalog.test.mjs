import test from "node:test";
import assert from "node:assert/strict";

import {
  ERROR_CATALOG,
  SERVER_CODE_MAP,
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
    EMAIL_VERIFICATION_REQUIRED: "PIT-AUTH-005",
    AUTH_INVALID: "PIT-AUTH-003",
    FORBIDDEN: "PIT-AUTH-002",
    FAN_CLUB_MEMBERSHIP_REQUIRED: "PIT-CHAT-001",
    LOUNGE_ATTENDANCE_REQUIRED: "PIT-CHAT-002",
    LOUNGE_CLOSED: "PIT-CHAT-003",
    CONTENT_REJECTED: "PIT-SAFE-001",
    ACTION_REQUIRED: "PIT-REQ-001",
    VALIDATION_FAILED: "PIT-REQ-001",
    RECOMMENDATION_CURSOR_INVALID: "PIT-REQ-004",
    RECOMMENDATION_CURSOR_EXPIRED: "PIT-REQ-004",
    NOT_FOUND: "PIT-REQ-002",
    CONFLICT: "PIT-REQ-003",
    ARTIST_MEMORIALIZED: "PIT-REQ-003",
    ARTIST_MEMORIAL_REQUIRED: "PIT-REQ-003",
    CHECK_IN_UNAVAILABLE: "PIT-SHOW-001",
    IDEMPOTENCY_MISMATCH: "PIT-REQ-003",
    IDENTITY_CHANGED: "PIT-AUTH-004",
    POST_REMOVED: "PIT-REQ-003",
    POST_MUTATION_CONFLICT: "PIT-REQ-003",
    RATE_LIMITED: "PIT-RATE-001",
    MEDIA_UPLOAD_QUOTA_EXCEEDED: "PIT-UPLOAD-005",
    DATABASE_UNAVAILABLE: "PIT-SVC-001",
    STORAGE_UNAVAILABLE: "PIT-SVC-001",
    MEDIA_STORAGE_UNAVAILABLE: "PIT-UPLOAD-001",
    REQUEST_TOO_LARGE: "PIT-REQ-005",
    MEDIA_TYPE_UNSUPPORTED: "PIT-UPLOAD-002",
    MEDIA_TOO_LARGE: "PIT-UPLOAD-003",
    MEDIA_UPLOAD_FAILED: "PIT-UPLOAD-004",
    PROVIDER_UNAVAILABLE: "PIT-SVC-002",
    INTERNAL_ERROR: "PIT-SVC-001",
  };
  assert.deepEqual(SERVER_CODE_MAP, expected);
  for (const [serverCode, pitCode] of Object.entries(expected)) {
    assert.equal(catalogueCode({ serverCode, status: 500 }), pitCode);
    assert.ok(ERROR_CATALOG[pitCode]);
  }
});

test("network, response, and HTTP failures normalize predictably", () => {
  assert.equal(catalogueCode({ kind: "network" }), "PIT-NET-001");
  assert.equal(catalogueCode({ kind: "abort" }), "PIT-NET-002");
  assert.equal(catalogueCode({ kind: "invalid_response", status: 200 }), "PIT-API-001");
  assert.equal(catalogueCode({ status: 408 }), "PIT-NET-002");
  assert.equal(catalogueCode({ status: 429 }), "PIT-RATE-001");
  assert.equal(catalogueCode({ status: 413 }), "PIT-REQ-005");
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
  assert.equal(safeRouteTemplate("/api/admin/artists/enrich"), "/api/admin/artists/enrich");
  assert.equal(safeRouteTemplate("/api/admin/artists/private-artist-key"), "/api/admin/artists/:id");
});

test("paused built-in playback incidents stay out of the general feedback catalog", () => {
  assert.equal(ERROR_CATALOG["PIT-MEDIA-001"], undefined);
  assert.equal(ERROR_CATALOG["PIT-MEDIA-002"], undefined);
});

test("closed live check-ins have specific safe recovery copy", () => {
  assert.equal(catalogueCode({ serverCode: "CHECK_IN_UNAVAILABLE", status: 409 }), "PIT-SHOW-001");
  const entry = catalogEntry("PIT-SHOW-001");
  assert.equal(entry.retryable, false);
  assert.match(entry.message, /Going or Went/);
  assert.doesNotMatch(`${entry.message} ${entry.guidance}`, /provider|timezone|lifecycle|database/i);
});

test("closed Lounges route members toward the artist community without suggesting a retry", () => {
  assert.equal(catalogueCode({ serverCode: "LOUNGE_CLOSED", status: 410 }), "PIT-CHAT-003");
  const entry = catalogEntry("PIT-CHAT-003");
  assert.equal(entry.retryable, false);
  assert.match(`${entry.message} ${entry.guidance}`, /24 hours after doors/);
  assert.match(entry.guidance, /Fan Club/);
});
