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
    MEDIA_EMAIL_VERIFICATION_REQUIRED: "PIT-UPLOAD-006",
    AUTH_INVALID: "PIT-AUTH-003",
    FORBIDDEN: "PIT-AUTH-002",
    CONTACT_NOT_ALLOWED: "PIT-CHAT-004",
    FAN_CLUB_MEMBERSHIP_REQUIRED: "PIT-CHAT-001",
    LOUNGE_ATTENDANCE_REQUIRED: "PIT-CHAT-002",
    LOUNGE_CLOSED: "PIT-CHAT-003",
    CONTACT_NOT_ALLOWED: "PIT-CHAT-004",
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
    SHARE_RENDER_UNAVAILABLE: "PIT-SVC-001",
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

test("email verification failures keep account access and media upload guidance distinct", () => {
  const accountAccess = catalogEntry(catalogueCode({
    serverCode: "EMAIL_VERIFICATION_REQUIRED",
    status: 403,
  }));
  const mediaUpload = catalogEntry(catalogueCode({
    serverCode: "MEDIA_EMAIL_VERIFICATION_REQUIRED",
    status: 403,
  }));

  assert.equal(accountAccess.category, "permission");
  assert.doesNotMatch(accountAccess.message, /photo or video upload/i);
  assert.equal(mediaUpload.category, "upload");
  assert.match(mediaUpload.message, /photo or video upload/i);
  assert.match(mediaUpload.message, /finish or remove an upload you already started/i);
});

test("direct-message contact policy failures explain the age and privacy boundary", () => {
  const contactPolicy = catalogEntry(catalogueCode({
    serverCode: "CONTACT_NOT_ALLOWED",
    status: 403,
  }));

  assert.equal(contactPolicy.category, "permission");
  assert.match(contactPolicy.message, /age or contact privacy rule/i);
  assert.match(contactPolicy.guidance, /age group.*message preferences.*mutual-follow/is);
  assert.equal(contactPolicy.retryable, false);
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

test("connectivity copy is plain while provider codes keep provider guidance", () => {
  const connectivity = catalogEntry(catalogueCode({ kind: "network" }));
  assert.equal(connectivity.message,
    "Mshpit couldn't connect. Check your internet connection and try again.");
  assert.doesNotMatch(connectivity.message, /venue/iu);

  const providerCode = catalogueCode({
    serverCode: "PROVIDER_UNAVAILABLE",
    status: 502,
    kind: "network",
  });
  const provider = catalogEntry(providerCode);
  assert.equal(providerCode, "PIT-SVC-002");
  assert.equal(provider.category, "provider");
  assert.match(provider.message, /music or ticket provider is temporarily unavailable/iu);
  assert.doesNotMatch(provider.message, /internet connection/iu);
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

test("direct-message safety refusals explain age and contact boundaries without suggesting a retry", () => {
  assert.equal(catalogueCode({ serverCode: "CONTACT_NOT_ALLOWED", status: 403 }), "PIT-CHAT-004");
  const entry = catalogEntry("PIT-CHAT-004");
  assert.equal(entry.retryable, false);
  assert.match(`${entry.message} ${entry.guidance}`, /age group/i);
  assert.match(`${entry.message} ${entry.guidance}`, /privacy|message preferences|mutual-follow/i);
});
