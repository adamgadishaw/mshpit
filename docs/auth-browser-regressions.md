# Browser authentication regressions

`npm run verify:auth-browser` tests the actual exported web application, including
React state, browser navigation, reload persistence, and request identity headers.
Run `npm run build:web` first; the verifier snapshots `dist` at startup and prints
the exported entry hash so an older build cannot be mistaken for a new fix.

The suite starts a loopback-only static server. Every API request is fulfilled by
fixtures and every non-local asset request is blocked. It never starts the real
application server, opens a database, creates an account, or contacts production.
Do not replace its local origin with a deployed URL.

## Browser prerequisite

This is an explicit browser check, separate from the default hermetic Node test
suite and deploy build. It needs an existing Playwright installation and Chromium.
It resolves `playwright` or `playwright-core` normally; alternatively set
`PIT_PLAYWRIGHT_MODULE` to an installed package's absolute module path.
`PIT_BROWSER_EXECUTABLE` optionally identifies an existing Chromium executable.
No browser or package is automatically downloaded by this script.

```sh
npm run build:web
npm run verify:auth-browser
node scripts/verify-auth-browser.mjs --list
node scripts/verify-auth-browser.mjs logout-
node scripts/verify-auth-browser.mjs login-canceled
node scripts/verify-auth-browser.mjs forms-
node scripts/verify-auth-browser.mjs guest-
```

`PIT_AUTH_BROWSER_DIST` can select a different **local** exported build directory.
Set `PIT_AUTH_BROWSER_SCREENSHOTS=1` to capture the mock-only mobile/desktop login
and signup layouts as `.tmp/credential-forms-*.png` during the semantic cases.
The optional positional argument filters case names. No match or any failed
assertion exits nonzero. Output is JSON lines with one outcome per case and an
exact final pass/fail count; failed cases include fixture request traces without
passwords, cookies, or tokens.

## Contract

The 46 cases include 16 logged-out interaction checks plus the original 30
authentication checks. Guest cases use an actual feed card for concert reviews,
online reviews, status posts and Going tickets on mobile and desktop widths.
Likes must open sign-in without loading the artist/show or sending a write.
Public comments stay readable; Reply and the composer sign-in button open auth;
the post footer stays in its own thread. Photo reactions and reports open auth,
and cancel/back preserves the current gallery item. Signing in after a guest
Like does not replay it; a new, deliberate member tap sends an account-bound
request. Missing API fixtures, page exceptions and crash reports fail each case.

The original authentication cases cover normal login on mobile/desktop, wrong-password retry,
multi-profile login choice, normal logout/reload on both widths, failed logout
with network failure and HTTP 500, linked switching on both widths, external
account switching, expired sessions on both widths, startup 401 with stale cache,
offline startup recovery on both widths, and canceled pending login via browser
Back on both widths, plus canceled linked-account switching via Back on both
widths. One additional failed-logout case makes localStorage throw
throughout startup and reload to verify the first-party cookie fallback.

Nine semantic-form cases check login and signup on both widths, password reset,
password change, linked-account connection, the Settings export-password field,
and explicit Owner decisions.
They require real connected form owners, unique input IDs, stable field names,
associated HTML labels, appropriate autocomplete tokens, and POST/noValidate forms
with a real submit button. Login and signup use the email login identifier as
`username`; a public signup handle must not claim login-username autofill.

Keyboard tests count native submit events as well as API requests, and exercise
duplicate suppression while a login request is held. Password visibility,
forgot/back/cancel controls must not submit.
Signup's credential inputs retain their owner and values across both steps, with
step one advancing without creating an account. Fixture passwords are rejected if
they appear in any request URL or the final browser address. These checks verify
browser semantics, not proprietary password-manager save prompts or real vaults.

The Owner case uses a mock administrator/Owner projection and a fake sealed audit
request. Enter in the password field must show decision guidance and send zero
decision requests; activating the selected approval button must send exactly once
with that submitter's decision. All review/decision responses are fixtures, so no
real approval, authority change, receipt, or email is created.

- Failed logout immediately clears private local state. Reload and forced
  revalidation cannot adopt the still-live server session. Once the logout
  endpoint recovers, online/auth-epoch revalidation retries revocation; another
  reload stays guest. The network and HTTP failure cases exercise these listeners
  separately.
- Leaving a pending login cancels its authority to adopt a response. The fixture
  can still finish server-side authentication after navigation, so the app must
  compensate with logout. Neither immediate state nor a later reload may reveal
  that account. A DOM observer also catches transient private identity flashes.
- Successful linked switching binds its request to the old account and all later
  account-bound reads to the selected account.
- Leaving a pending linked switch clears private state and compensates its late
  server cookie with logout. The target account stays absent after reload.
- Ordinary successful flows continue to work. Expired and unverified startup
  sessions do not display the cached private identity.
- No uncaught page error, runtime console exception, error boundary, or crash
  receipt is acceptable. Expected HTTP/network resource errors from injected
  failures are allowed.

The fixture models server session ownership; it does not prove production cookie
attributes, database revocation, cryptography, Safari behavior, or native mobile
behavior. Those require the corresponding server/native tests. Widths 390 and
1280 are Chromium viewport checks, not physical-device validation.

## Actual local HTTP listener and cookies

`node scripts/verify-auth-real-server.mjs` adds the actual `server/index.js`
listener to the exported-app check. It uses the same Playwright environment
variables as the mock suite and requires an existing `dist` export. It must not
be pointed at production: the origin and fresh temporary data directory are
created internally, and no `.env` file or inherited provider credentials are
loaded.

The explicit test-only preload seeds synthetic accounts and session records,
blocks all child-process outbound fetch/HTTP/TLS/socket connections, and shares
fixture metadata only through process IPC. Its listening socket is restricted to
127.0.0.1, so synthetic credentials are not exposed on the LAN. The listener's request parsing,
origin/account guards, cookie handling, routes, SQLite transactions, and rate
limits are unchanged. Temporary database files are removed only after the child
exits and the exact temporary target path is checked. No production module
imports the preload or exposes a test HTTP route.

The desktop browser checks real login/account choice, HttpOnly cookie adoption,
reload, linked switching, cookie rotation, logout, and cleared-state reload.
Requests through the real listener additionally check stale-cookie replay,
expected-account mismatch, single-use reset and prior-session revocation,
password-change rotation, and 5/10/50/100 simultaneous authenticated `/api/me`
reads using separate synthetic account sessions. The two UI login requests stay
within normal authentication rate limits; these limits are never reset/bypassed.
Reported timing is a localhost fixture measurement, not a production capacity
or device performance claim. The listener runs in test/development HTTP mode;
production HTTPS, `__Host-` cookies, proxies and deployment configuration need
their separate server/deployment tests.

## Authentication reliability review — 2026-10-15

Release baseline: `92aa96d4f2f18d15222f0453ecf2eed4be971306`. The earlier
verification fix branch was based on stale local `master`; its two commits have
been integrated onto `codex/auth-reliability-20261015`. The original branch is
retained. Do not push the stale local `master` as a release.

Supported account authentication is email/password. Signup supports fan and
artist intent, and password-matched linked profiles can be selected or switched.
There is no implemented social-login, passkey, or magic-link sign-in method.
An email-confirmation link confirms an address; it does not sign in an account.

| Priority | Journey / risk | Required behavior and evidence |
| --- | --- | --- |
| High | Signup commits but response disappears | Preserve account creation; show that it may have succeeded and direct the person to deliberate login. Actual HTTP/browser regression drops the successful signup response, then logs in and reloads. No second account is created. |
| High | Reset commits but response disappears | Keep the token single-use; say the password may already have changed and offer login with the new password. Actual HTTP/browser regression drops a committed reset response, verifies prior-session revocation, logs in, and proves token replay is still rejected. |
| High | A reset link belongs to a different account | Explain that the link controls its recipient account, show the currently signed-in handle, and label the action as a session switch. Actual HTTP/browser regression verifies the target session changes while an unrelated account's sessions remain intact. |
| High | Older email link after resend | Reject the replaced token; use the most recent email and offer signed-in recovery. `server/verificationRecovery.test.mjs` performs signup, resend, old-link rejection, newest-link success, a follow write, and feed read. |
| High | Cross-tab logout, account switch, expired cookie | Revalidate server identity, fence stale replies, clear private state, and retain the durable sign-out barrier. Browser suite covers returning/expired sessions; the actual listener test uses a second live tab during logout and tests stale cookies and expected-account mismatch. |
| High | Manual admin approval | Admin authority is checked under the write lock. Require reason, selected target, and current email revision. Audit, provenance and token cleanup commit together. Independent-connection tests cover concurrent requests and demotion while awaiting the lock. |
| Medium | Opening another account link in the same tab | Listen to same-document reset/verify fragment/history navigation, replace the active authentication flow, scrub the URL, and remount token-specific forms so stale requests cannot update the replacement form. Malformed, duplicate or conflicting capabilities clear the older form and show recovery without an authentication request. Browser regression first reproduced failure without reloading the page. |
| Medium | Forgot-password acknowledgement, cooldown or mail failure | Remain neutral about account existence and delivery. Explain latest-email guidance, one-hour expiry, and the existing 15-minute repeat-request cooldown. Do not report that an email was delivered. |
| Medium | Reset validation / expired or replaced link | Match the server's password policy before sending. Keep explicit login and request-another-link actions available after rejection. Browser regressions cover both viewport widths. |
| Medium | Slow or duplicate submissions | Disable repeat submission while pending, preserve form input on failure, cancel ownership when leaving, and revoke uncertain cookie outcomes. Existing keyboard/held-login tests and new reset cross-tab tests exercise real rendered screens. |
| Medium | Offline startup and unavailable storage | Never authenticate a cached private projection. Keep recovery/retry available; preserve intent through cookie or native persistence fallback. Browser startup/offline cases and native adapter lifecycle tests are separate evidence. |
| Medium | Additional / linked profiles | Require current credential proof where applicable, preserve two-profile limits, bind expected account on mutations, rotate cookies on switch, and never replay a protected guest action after login. |
| Low | First public visit | Public browsing remains available without signup. Verification remains required for protected social mutations; recovery changes do not remove that boundary. |
| Platform gap | Native incoming account links | Shared source declares the `mshpit` scheme but does not consume cold/warm reset or verification URLs. HTTPS association / verified-link configuration is not present. This review does not add an insecure custom-scheme bearer-token handoff or touch the separate Android checkout. Existing native resume and persisted-intent logic can be tested as modules, not claimed as device validation. |
| Platform gap | Safari, iPhone and proprietary password managers | 390px and 1280px Chromium are browser viewport tests. They are not Safari/WebKit, physical iPhone, native app, email-client, or password-vault validation. These remain an explicit device-test requirement. |

### Release and rollback checklist

1. Read the remote master SHA again before integration. At investigation time it
   was `92aa96d4f2f18d15222f0453ecf2eed4be971306`; local master was 86 commits
   behind, and the original fix branch was 2 unique commits ahead / 86 behind.
   Tracking `origin/master` was stale and must not be mistaken for the fresh
   remote observation. Integrate only the final reviewed current-base branch,
   resolve any newer changes, and rerun the full build/tests. Keep the separate
   Discover work isolated until its reviewed changes are intentionally combined.
2. Obtain explicit release approval for the exact final commit. Repository
   configuration targets `master` with `autoDeployTrigger: checksPass`, so a
   push/merge can initiate deployment. Preparation is not permission to do so.
3. The configured runtime entry is `scripts/start-production.mjs`. Before it
   imports the database migration code, it requires a consistent SQLite
   `VACUUM INTO` snapshot and verifies it. Confirm the snapshot exists on the
   persistent data disk, opens successfully, and passes the repository's
   manifest, table-count, integrity and foreign-key checks. Do not copy a live
   `pit.db` alone while its WAL is active. Do not bypass a backup failure or
   enable empty-database bootstrap to get past it.
4. The additive migration creates nullable `email_verification_method`, plus
   `email_verification_revision INTEGER NOT NULL DEFAULT 0` and an email-update
   revision trigger. Startup applies these inside its existing immediate
   transaction. A later migration failure rolls all three back; tests verify
   this and a subsequent successful retry. Legacy verification/provenance is
   not reclassified as proof of delivery.
5. A persistent disk prevents zero-downtime replacement. Confirm startup backup
   and migration success, then use read-only health/readiness and exact release
   identifiers to verify rollout. No actual account verification or real email
   test is implied by release approval. Those need their own authorization.
6. For a code rollback, retain the additive columns/trigger. An older binary
   can use the schema but does not enforce the new admin contract or maintain
   new provenance; do not treat old behavior as equivalent. A database restore
   is a separate destructive operation that can discard writes since the
   snapshot and requires an explicit, reviewed recovery plan. Do not restore a
   backup automatically as part of a code rollback.

The legacy exported `forceVerify` helper has only test callers. Runtime manual
administration uses the audited HTTP action; new callers must not reuse the
legacy helper's older welcome/audit behavior. Any future email-change flow must
still invalidate its verification state and live capabilities; the revision
trigger protects stale admin selection and does not introduce an email-change
feature.

### Local validation evidence

The final exported entry is `index-523371a5a202f8f8bd6fb10db2dfc2c4.js`.
`node scripts/run-tests.mjs` completed with 6,297 passed, one skipped and zero
failures (6,298 total). `check-syntax` passed all 852 Node files and the
architecture gate passed without increasing its allowances. Production web
export passed with 507.6 KiB initial gzip JavaScript against the 512 KiB limit.
The full mocked-API Chromium browser suite passed 76/76 cases at mobile and
desktop widths. The actual local listener plus Chromium runner passed 15/15 cases with fresh
synthetic accounts, an isolated throwaway database, and outbound traffic blocked.
The independent reviewer reported no remaining blocking findings and separately
passed 41 focused tests plus 23 final link/parser/transition tests.

The deployed incident's strongest hypothesis remains an older link opened after
resend; response bodies and account identity were unavailable, so this is not a
proven root cause. The fix addresses the reproduced failure modes without
claiming that administrative verification proves delivery of an email.
