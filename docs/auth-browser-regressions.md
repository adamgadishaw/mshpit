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
```

`PIT_AUTH_BROWSER_DIST` can select a different **local** exported build directory.
The optional positional argument filters case names. No match or any failed
assertion exits nonzero. Output is JSON lines with one outcome per case and an
exact final pass/fail count; failed cases include fixture request traces without
passwords, cookies, or tokens.

## Contract

The 19 cases cover normal login on mobile/desktop, wrong-password retry,
multi-profile login choice, normal logout/reload on both widths, failed logout
with network failure and HTTP 500, linked switching on both widths, external
account switching, expired sessions on both widths, startup 401 with stale cache,
offline startup recovery on both widths, and canceled pending login via browser
Back on both widths. One additional failed-logout case makes localStorage throw
throughout startup and reload to verify the first-party cookie fallback.

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
- Ordinary successful flows continue to work. Expired and unverified startup
  sessions do not display the cached private identity.
- No uncaught page error, runtime console exception, error boundary, or crash
  receipt is acceptable. Expected HTTP/network resource errors from injected
  failures are allowed.

The fixture models server session ownership; it does not prove production cookie
attributes, database revocation, cryptography, Safari behavior, or native mobile
behavior. Those require the corresponding server/native tests. Widths 390 and
1280 are Chromium viewport checks, not physical-device validation.
