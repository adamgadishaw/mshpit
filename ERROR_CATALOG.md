# Pit error catalogue

Pit errors use stable public references so a user screenshot, support report,
and local diagnostic entry point to the same failure class. Do not renumber or
reuse a published `PIT-*` code for a different meaning.

## Catalogue

| Code | Category | Meaning | Retry |
| --- | --- | --- | --- |
| `PIT-NET-001` | Connectivity | The client could not reach Pit | Yes |
| `PIT-NET-002` | Connectivity | A request timed out or was aborted | Yes |
| `PIT-AUTH-001` | Authentication | Session missing, invalid, or expired | Sign in first |
| `PIT-AUTH-002` | Permission | Signed-in account lacks permission | No |
| `PIT-AUTH-003` | Authentication | Email or password confirmation did not match | Check first |
| `PIT-REQ-001` | Validation | Submitted details were rejected | Edit first |
| `PIT-REQ-002` | Not found | Requested record is unavailable | Refresh first |
| `PIT-REQ-003` | Conflict | Duplicate or stale update | Refresh first |
| `PIT-RATE-001` | Rate limit | Request limit reached | After a pause |
| `PIT-SVC-001` | Service | Pit service/internal failure | Yes |
| `PIT-SVC-002` | Provider | External music/ticket provider unavailable | Later |
| `PIT-API-001` | Response | Client could not safely parse the API response | Yes |
| `PIT-UPLOAD-001` | Upload | Durable media storage unavailable | Later |
| `PIT-UPLOAD-002` | Upload | Unsupported media type | Choose another file |
| `PIT-UPLOAD-003` | Upload | Media exceeds the size limit | Resize first |
| `PIT-UPLOAD-004` | Upload | Media upload failed | Yes |
| `PIT-MEDIA-001` | Playback | Audio/video could not start | Yes |
| `PIT-STORE-001` | Storage | Device-local persistence failed | Yes |
| `PIT-APP-001` | Application | React render failure caught by the app boundary | Yes |
| `PIT-UNK-001` | Unknown | Unclassified client failure | Yes |

The complete user title, message, failure point, and retry guidance live in
`src/lib/errorCatalog.mjs`. Server codes such as `AUTH_REQUIRED`,
`MEDIA_TOO_LARGE`, and `PROVIDER_UNAVAILABLE` map to these public references
without being discarded.

## Client integration

API calls remain backward compatible:

```js
api("/api/posts", {
  method: "POST",
  body,
  context: "Publishing a concert review",
  silent: false,
  timeoutMs: 30000,
});
```

- Every failed API call is recorded.
- GET failures stay in Diagnostics without creating toast noise.
- Failed mutations show one deduplicated themed message unless `silent: true`.
- `silent` only suppresses the toast; it never suppresses diagnostics.
- Reads time out after 20 seconds and writes after 30 seconds by default;
  `timeoutMs` can set a bounded per-call deadline and caller `signal` cancellation
  remains supported.
- Thrown `AppError` values include `status`, public `code`, `serverCode`,
  `requestId`, `retryable`, category, severity, and themed user copy.

Non-API code uses the same path:

```js
captureAppError(error, {
  code: "PIT-MEDIA-001",
  context: "Starting YouTube playback",
  source: "youtube-player",
  toast: true,
});
```

## Privacy rule

Diagnostics may contain only operation labels, route templates, HTTP method and
status, stable error codes, source, timestamp, and request ID. Never record:

- passwords, session/reset tokens, authorization headers, or cookies;
- request/response bodies or query-string values;
- message, review, search, or profile text;
- photo contents or local file paths;
- email addresses, raw user IDs, or raw stack traces.

The diagnostics service strips query strings and replaces resource identifiers
with `:id`. Raw errors can still be written to development console output, but
must not be persisted or shown to other users.
