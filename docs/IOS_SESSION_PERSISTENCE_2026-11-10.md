# iOS session persistence investigation — 2026-11-10

## Scope and evidence

Work is isolated on `fix/native-session-persistence`, based on native profile
candidate `b1c9514`. No phone, account/session data, deployment, signing settings,
or previous release artifact was changed. The reported phone behavior has not
been reproduced on a device; the defects below are reproduced with synthetic I/O.

The installed-source reference `296ce4b` and candidate `b1c9514` have identical
API transport, native persistence, auth intent/coordinator, session validation,
server auth files, and Store validation/auth-handler sections. This establishes
that both source versions contain these paths; it does not establish which
failure occurred on the phone.

Native authentication uses the server's HttpOnly cookie through React Native
`fetch` with `credentials: include`. The reviewed React Native implementation uses
the default NSURLSession and shared HTTPCookieStorage. `pit.session` is an identity
cache, not a credential; cold start remains locked until `/api/me` confirms identity.
There is no SecureStore bearer-token implementation to restore or migrate.

The unchanged server policy expires member sessions after 30 days and full
admin/moderator/editor sessions after 12 hours, measured from issuance. Activity
does not renew these sessions. This can explain periodic staff sign-in but has
not been correlated with the report. Normal expiry/revocation produces
`200 {user:null}` from `/api/me`; a genuine JSON 401 also retires the local account.

## Separately reviewable corrections

1. `84923bb` preserves the transport's existing network, timeout, and unreadable
   response classifications when a failed identity read happens to carry HTTP
   status 401. Previously HTML, malformed JSON, or a dropped/timed-out response
   body could purge a confirmed account. A routine foreground failure now keeps
   the confirmed UI and retries; cold/strict checks stay locked. Actual JSON 401,
   explicit guest, logout, and account-switch boundaries are unchanged.
2. Native authentication now confirms the exact phase/revision/order directly in
   SQLite, bypassing the persistence adapter's in-memory fallback. A failed
   pending write prevents the cookie-changing request and preserves the previous
   account. A failed signed-in commit never publishes success; the existing
   uncertain-response path blocks and revokes the possibly issued cookie. The
   form reports `PIT-STORE-004` with storage/retry guidance. This does not make
   optional cache failures revoke valid sessions. Web fallback behavior is unchanged.

An explicit logout still clears local state and attempts server revocation even
if local writes fail. No implementation can promise restart persistence while
all backing writes fail; the existing storage diagnostic remains applicable.
Interrupted/persisted-pending sign-ins continue to fail closed on restart.

## Validation and release boundaries

Normal `npm test` discovers the expanded `sessionValidationRecovery.test.mjs`
and `nativeAuthIntentLifecycle.test.mjs` files. They execute the actual Store
closures, API transport, AppError catalog, native persistence adapter, raw-SQLite
confirmation module, and production auth coordinator wiring against isolated
responses/storage. Coverage includes reconnect, cold start, strict checks,
genuine expiry, dropped/silent writes, process recreation, successful retry,
account switching, cancellation, newer login, explicit logout, and ordering
saturation. These are runtime tests with mocked platform I/O, not physical iOS
cookie-store or keychain acceptance.

Validation receipts and installed-source hashes are under
`.tmp/session-checks/` in the isolated checkout. Native JS export is a module
resolution/build check, not a signed candidate or device installation. The prior
signed `b1c9514` candidate does not contain these changes. Future integration
needs fresh candidate build/review and phone acceptance through parent coordination.

Exact Expo 57 index, SecureStore, and SQLite documentation was read before this
work. No credential lifetime, cookie flags, native dependency, update/distribution
configuration, or server authorization rule was changed.
