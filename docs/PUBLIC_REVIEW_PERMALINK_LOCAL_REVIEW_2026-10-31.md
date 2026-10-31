# Public review permalink - local review

Base: fresh isolated clone of remote master
`91cef8b9eabe2a97d3e7daf255dad67ec406e809`.
Branch: `fix/public-review-permalink`.
Checkout: `C:\Users\Adam Gadishaw\Documents\Codex\2026-10-31\task-9\mshpit-review-permalink`.
No existing checkout was modified. Initial preparation was local only; the owner
subsequently authorized a branch push and draft PR for checks. No merge, auto-merge,
deployment, production content change or account mutation is authorized.

## Evidence and root cause

The parent reported two live browser reproductions where the Andrew review's
permalink changed to a concert page; Profile -> See more opened the review.
Those browser sessions showed account-specific controls, so they do not establish
guest browser behavior. No authenticated live browser test was performed here.

A fresh anonymous PowerShell GET, without cookie/session options, to the public
post endpoint on 2026-10-31 returned the route-relevant shape:
`kind: review`, artist `Hollowfest / Nessfest`, venue `The Woods`,
date `2026-10-16`, city `Perth, Ontario, Canada`, and
`archiveShowKey: show.WyJob2xsb3dmZXN0IC8gbmVzc2Zlc3QiLCJ0aGUgd29vZHMiLCIiLCIyMDI2LTEwLTE2Il0`.
The public resolver returned `kind: show` and the canonical `/post/p_a7f5a3f555e317fb2742ae6ff7db68df`.
This establishes anonymous API visibility, not guest browser rendering.

The baseline browser destination helper selected `openLog` for ordinary reviews.
`showNavigationPostId` suppresses the post ID when an archive key is present;
`publicFramePath` therefore serializes the frame as `/concert/<archiveShowKey>`.
ShowScreen then requires canonical artist identity before exposing its performance
content, which is unsuitable for this combined festival label. The server's
`kind: show` is explicitly a persisted post compatibility identity; real
concerts and events have separate entity kinds.

## Correction

`publicBrowserDestination.mjs` now returns a post frame after the fresh post read.
It keeps cancellation and missing-record behavior. Presentation hints are no
longer needed to preserve the review on reload or uncached history restoration.
The existing post frame serializer already prefers its post ID, so no change to
concert serialization or show identity rules is necessary. Performance screens
remain available through explicit concert/event routes and in-app show actions.

The regression fixture uses the actual public route-relevant archive key and
festival/venue/date shape with synthetic author, post ID and text. It includes a
missing artist key to prevent an accidentally successful artist lookup from
concealing the defect. Desktop/mobile cases cover guest and member states,
visible review and comments, canonical URL, reload, Home and browser Back/Forward.
All browser APIs are mocked and external requests are blocked.

## Validation

- Baseline resolver, evaluated from master without modifying the working source,
  converted the archive-linked fixture to an openLog/concert URL for both account
  states. The fixed resolver round-trips it as the post.
- Final focused suite: 46/46 passed, including city-only/online reviews, genuine
  events/concerts, missing records, cancellation, session boundaries and fixtures.
- New exported-app regressions: 4/4 passed (390/1280 px, guest/member). The full
  navigation browser suite passed 71/71, including other public routes, event
  cancellation, artist navigation, member/guest tabs, account boundaries and
  server-owned collections. Every API was intercepted and external traffic blocked.
- Final `npm run check` stopped at its test stage: 7,072 passed, two failed, one
  existing Windows skip (7,075 total). Both failures are in unchanged festival
  scan/SEO tests: first-cycle lineupChangedAt expected null, then performer count
  expected four but observed three. The same 9/11 result reproduces from an
  untouched `git archive HEAD` master snapshot with a fresh throwaway database.
  This candidate does not modify festival implementation or policy.
- Separate production dependency audit: zero vulnerabilities. Production web
  export and bundle budget passed: 506.2/512 KiB gzip initial JavaScript.
- Syntax passed (919 Node files); architecture and `git diff --check` passed.

Two old city-only/online tests asserted the removed resolver source expression;
these now assert behavior through the real helper. Existing in-app checks remain.
Full aggregate check is not represented as a pass.

Separate reviewer: no correctness findings. Confirmed server entity-kind contract,
unchanged genuine event/concert routing, abort/missing-record behavior and fixture
adequacy. Independently ran 35 focused tests, all passed, and diff whitespace check.

## Limits and release

No native device or production browser verification is claimed. Session cases use
synthetic local sessions and intercepted APIs. No database migration is needed.
A future separately authorized web release would need deployment and live smoke
verification. The owner subsequently authorized committing/pushing this reviewed
candidate and opening a draft PR for checks; deployment remains outside scope.

Reproduction commands: `npm run check`, `npm run check:dependencies`,
`npm run check:syntax`, `npm run check:architecture`, `npm run build:web`;
`node scripts/verify-navigation-browser.mjs archive-review` and the same browser
command without a filter for the full suite. Browser tooling is separate pinned
Playwright 1.62.1 under ignored `.tmp/browser-tools`, using installed Chrome via
`PIT_PLAYWRIGHT_MODULE` and `PIT_BROWSER_EXECUTABLE`. Repository dependencies
were installed with `npm ci`; lockfile and package manifest are unchanged.

Evidence logs are under ignored `.tmp/`: `focused-tests.log`,
`browser-archive-review.log`, `browser-all.log`, `check-final.log`,
`festivals-isolated.log`, `festivals-master-baseline.log`, `build-web.log`.
