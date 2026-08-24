// Stable, public API failure codes. Messages may improve over time; callers
// should branch on `code`, use `error` for display, and include `requestId`
// when reporting a problem. Never put secrets or raw exception text here.
export const ERROR_CATALOG = Object.freeze({
  AUTH_REQUIRED: { status: 401, retryable: false },
  AUTH_INVALID: { status: 401, retryable: false },
  EMAIL_VERIFICATION_REQUIRED: { status: 403, retryable: false },
  FORBIDDEN: { status: 403, retryable: false },
  FAN_CLUB_MEMBERSHIP_REQUIRED: { status: 403, retryable: false },
  LOUNGE_ATTENDANCE_REQUIRED: { status: 403, retryable: false },
  CONTENT_REJECTED: { status: 422, retryable: false },
  ACTION_REQUIRED: { status: 422, retryable: false },
  VALIDATION_FAILED: { status: 400, retryable: false },
  RECOMMENDATION_CURSOR_INVALID: { status: 400, retryable: false },
  RECOMMENDATION_CURSOR_EXPIRED: { status: 400, retryable: false },
  NOT_FOUND: { status: 404, retryable: false },
  CONFLICT: { status: 409, retryable: false },
  IDENTITY_CHANGED: { status: 409, retryable: false },
  POST_REMOVED: { status: 409, retryable: false },
  POST_MUTATION_CONFLICT: { status: 409, retryable: false },
  RATE_LIMITED: { status: 429, retryable: true },
  MEDIA_UPLOAD_QUOTA_EXCEEDED: { status: 429, retryable: true },
  DATABASE_UNAVAILABLE: { status: 503, retryable: true },
  STORAGE_UNAVAILABLE: { status: 503, retryable: true },
  MEDIA_STORAGE_UNAVAILABLE: { status: 503, retryable: true },
  REQUEST_TOO_LARGE: { status: 413, retryable: false },
  MEDIA_TYPE_UNSUPPORTED: { status: 415, retryable: false },
  MEDIA_TOO_LARGE: { status: 413, retryable: false },
  MEDIA_UPLOAD_FAILED: { status: 502, retryable: true },
  PROVIDER_UNAVAILABLE: { status: 502, retryable: true },
  INTERNAL_ERROR: { status: 500, retryable: true },
});

const STATUS_CODES = Object.freeze({
  400: "VALIDATION_FAILED",
  401: "AUTH_REQUIRED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  413: "REQUEST_TOO_LARGE",
  415: "MEDIA_TYPE_UNSUPPORTED",
  422: "ACTION_REQUIRED",
  429: "RATE_LIMITED",
  500: "INTERNAL_ERROR",
  502: "PROVIDER_UNAVAILABLE",
  503: "MEDIA_STORAGE_UNAVAILABLE",
});

export function errorCodeForStatus(status) {
  return STATUS_CODES[status] || (status >= 500 ? "INTERNAL_ERROR" : "VALIDATION_FAILED");
}

export class ApiError extends Error {
  constructor(status, message, code, cause) {
    super(message, cause ? { cause } : undefined);
    const requestedStatus = Number(status) || 500;
    const explicitCode = typeof code === "string" && code.length > 0;
    const resolvedCode = explicitCode ? code : errorCodeForStatus(requestedStatus);
    const definition = ERROR_CATALOG[resolvedCode];
    if (!definition) {
      throw new TypeError(`Unknown API error code: ${String(resolvedCode)}`);
    }
    if (explicitCode && requestedStatus !== definition.status) {
      throw new TypeError(
        `API error ${resolvedCode} requires status ${definition.status}, received ${requestedStatus}`,
      );
    }
    this.name = "ApiError";
    this.status = definition.status;
    this.code = resolvedCode;
  }
}

export function errorEnvelope(error, requestId) {
  const safe = error instanceof ApiError
    ? error
    : new ApiError(500, "Something broke on our end, it's been logged.", "INTERNAL_ERROR");
  const definition = ERROR_CATALOG[safe.code] || ERROR_CATALOG.INTERNAL_ERROR;
  return {
    error: safe.message,
    code: safe.code,
    status: safe.status,
    requestId,
    retryable: definition.retryable,
  };
}

// Error messages and stacks are not safe telemetry: provider clients commonly
// include URLs, query keys, addresses, paths, or request data in them. Runtime
// logs use only this bounded structural classification.
export function privateErrorLabel(error) {
  const cleanPart = (value, fallback = "") => {
    const text = String(value || fallback).replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 40);
    return text || fallback;
  };
  const name = cleanPart(error?.name, "Error");
  const code = cleanPart(error?.code);
  return code ? `${name}/${code}` : name;
}
