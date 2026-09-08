# Session and media authorization audit — 8 September 2026

## Scope and method

Reviewed the reported landing/sign-in/sign-out failures and their effects on
account switching, reset, expiry, uploads, photo permissions and publishing.
Used real application callbacks, isolated SQLite databases, delayed/failed
transports, and a production-built browser app with synthetic account fixtures.
No production user, password, session or media record was changed by the tests.
This is a focused security/functional review, not a certification of every route
or a production traffic-capacity assessment.

## Confirmed problems fixed

| Finding | Change and regression coverage |
| --- | --- |
| Failed logout looked successful, then accepted the old cookie after reload | Durable non-secret sign-out intent, immediate private-state cleanup, explicit pending feedback, and revocation retries. A leftover cookie cannot unlock the UI without a deliberate successful sign-in. |
| Native sign-out intent disappeared on process restart | Persist the non-secret intent through the existing SQLite adapter; process-recreation tests cover failed logout, interrupted login and confirmed login. |
| Delayed login/reset could override navigation or a newer logout | One ordered cookie-write coordinator, intent revisions, form cancellation and compensating logout. Browser Back, overlapping auth operations and cross-tab ordering have regressions. A fetch abort alone is not treated as server revocation. |
| Older blocked-directory responses overwrote newer privacy state | Account epoch, read order and block-mutation revision must all match before adopting the result. Server-side block enforcement is unchanged. |
| Login truncated overlength passwords | Inputs longer than the supported limit are rejected; a correct 100-character prefix plus an incorrect suffix cannot authenticate. |
| Server authorization was captured before awaiting the request body | Resolve the session after reading the bounded body. Long-running work checks its original session again before committing, including account restrictions. |
| Upload/picker continuations were not consistently tied to their initiating account | Bind original/legacy upload requests to the owner, cancel screen-owned work on exit/switch, and ignore old picker/progress/upload/publish results. A→B→A also invalidates the old operation. |
| Revoked/expired sessions could finish media processing using earlier authority | Source, variant, revision, legacy-photo and detached-video finalization recheck authorization. Publishing/profile transactions check again before attaching media. |

## Verified foundations

- Credentials remain on the server. Session tokens are cryptographically random;
  the database stores their hashes. Production session cookies use Secure,
  HttpOnly, SameSite and host-only protections.
- There is no separate refresh token: member sessions expire after 30 days and
  staff sessions after 12 hours. Expiration requires reauthentication. A new
  session does not retroactively authorize work begun by a revoked session.
- Password reset/change, linked-account access, expected-account binding,
  mutation-origin checks and server-side photo/message blocks retain their
  existing enforcement. Account switching does not share unrelated credentials.
- Original camera files remain private. Upload identifiers, finalization and
  publication are owner-checked; another account cannot claim the asset.
- Expiry/401 stops the upload pipeline rather than retrying it as someone else.
  Explicit logout retains the existing policy of clearing that account's local
  private drafts/caches. Server draft retention is not a promise that a local
  composer will survive logout or loss of its local references.
- Independent-account and same-account/revoked-session tests check that one
  user's failure does not grant access to, or revoke, another user's session.

## Browser regression suite

`npm run verify:auth-browser` serves only a local build, mocks API responses and
blocks external network destinations. It exercises mobile/desktop login,
incorrect-password recovery, two-account selection, normal and failed logout,
linked/external switching, expired sessions, offline startup, canceled login,
and logout with unavailable localStorage. See `auth-browser-regressions.md` for
portable setup and commands. Mocked browser tests complement, rather than
replace, the real-session server integration tests.

## Boundaries and follow-up

1. A presigned upload is a short-lived capability. Logout cannot recall bytes
   already being transferred to private object staging. Finalization and post
   association still require current authorization.
2. A sanitized derivative already PUT to public storage just before revocation
   is not instantly unreadable. It is not attached or returned by the failed
   operation, remains in the ownership ledger, and enters the existing orphan
   deletion queue after configured retention (default 48 hours). Actual deletion
   also depends on cleanup execution. Strict immediate revocation would require
   private delivery/publication gating and CDN invalidation work; this change
   does not claim that architecture exists.
3. Browser testing uses Chromium at mobile/desktop widths, not physical iPhone
   Safari. Native persistence has isolated adapter coverage, not a physical
   native-app smoke test. Device testing remains a release follow-up.
4. Cross-tab cookie mutations use Web Locks when supported; older runtimes only
   provide the per-process queue plus intent fencing. If all durable device
   storage is unavailable, only the in-memory sign-out barrier survives.
5. No live credential attack, production load test, Render configuration audit
   or exhaustive authorization review of every endpoint was performed here.
   The former signed-out You-page render crash was separately verified fixed
   in the previously deployed build; it was not evidence of a traffic overload.

## Release verification

Final checks passed before commit/push:

- `npm run check`: **3,619/3,619 tests passed**, zero failed/skipped;
  dependency audit reported **0 vulnerabilities**. Syntax, architecture and
  production web export all passed.
- Initial JavaScript: **490.1 KiB gzip / 512.0 KiB budget**.
- Final browser matrix: **19/19 passed**, no runtime crashes, against exact entry
  `index-f948d3396d84198c4a745f133ab6e5d2.js`.
- Native process-recreation and real-server authorization tests are included
  in the Node suite; native devices and Safari were not run.
- `git diff --check`: passed. No schema migration or dependency upgrade.
- Anonymous production health/readiness spot checks both returned HTTP 200
  before push. These are availability snapshots, not proof of the new release
  being deployed or of traffic capacity. Deployment completion is separate.

## Implementation references

- `src/domain/authTransitions.mjs`, `src/lib/authTransitions.js`
- `src/lib/authIntentPersistence.mjs`, `src/store.js`
- `src/hooks/useAccountTaskScope.js`, `src/lib/mediaAssetUpload.js`
- `server/requestAuthorization.js`, `server/mediaAssets.js`
- `server/mediaLegacyFinalize.js`, `server/api.js`

Version-specific guidance: [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/).
Cross-tab serialization follows the [Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API).
