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
```

`PIT_AUTH_BROWSER_DIST` can select a different **local** exported build directory.
Set `PIT_AUTH_BROWSER_SCREENSHOTS=1` to capture the mock-only mobile/desktop login
and signup layouts as `.tmp/credential-forms-*.png` during the semantic cases.
The optional positional argument filters case names. No match or any failed
assertion exits nonzero. Output is JSON lines with one outcome per case and an
exact final pass/fail count; failed cases include fixture request traces without
passwords, cookies, or tokens.

## Contract

The 30 cases cover normal login on mobile/desktop, wrong-password retry,
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
