// Stable, public API failure codes. Messages may improve over time; callers
// should branch on `code`, use `error` for display, and include `requestId`
// when reporting a problem. Never put secrets or raw exception text here.
export const ERROR_CATALOG = Object.freeze({
  AUTH_REQUIRED: { status: 401, retryable: false },
  AUTH_INVALID: { status: 401, retryable: false },
  FORBIDDEN: { status: 403, retryable: false },
  VALIDATION_FAILED: { status: 400, retryable: false },
  NOT_FOUND: { status: 404, retryable: false },
  CONFLICT: { status: 409, retryable: false },
  RATE_LIMITED: { status: 429, retryable: true },
  MEDIA_STORAGE_UNAVAILABLE: { status: 503, retryable: true },
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
  413: "MEDIA_TOO_LARGE",
  415: "MEDIA_TYPE_UNSUPPORTED",
  429: "RATE_LIMITED",
  500: "INTERNAL_ERROR",
  502: "PROVIDER_UNAVAILABLE",
  503: "MEDIA_STORAGE_UNAVAILABLE",
});

export function errorCodeForStatus(status) {
  return STATUS_CODES[status] || (status >= 500 ? "INTERNAL_ERROR" : "VALIDATION_FAILED");
}

export class ApiError extends Error {
  constructor(status, message, code = errorCodeForStatus(status), cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "ApiError";
    this.status = Number(status) || 500;
    this.code = ERROR_CATALOG[code] ? code : errorCodeForStatus(this.status);
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
