# Navigation and SEO repair — September 14, 2026

## Confirmed failure

The app could show Intro while keeping a Google-linked event address. Browser
Forward behaved like Back, startup added duplicate history entries, and delayed
link resolution could replace a newer destination. Some server-rendered filtered
or paginated collections were replaced by a different client screen.

## Repair

- One browser-history owner now coordinates URL, visible screen, Back, Forward,
  reload, and canceled composer navigation. Initial links replace their current
  position rather than creating duplicate entries.
- Home/Intro is `/`; the main tabs have `/feed`, `/search`, `/discover`, and `/you`.
  Feed and You remain account-gated. Member Home includes direct Feed/You actions.
  Successful Intro sign-in opens Feed; contextual sign-in returns to its parent.
  Password-reset success also opens Feed, while cancellation stays on Home.
- Account switching no longer invokes the departing screen's Back callback after
  the new account has already opened Feed. Post sign-in retains only a bounded
  presentation hint and reloads the post with the current account's permissions;
  it does not reuse cached guest/member content or replay the attempted Like.
- Artist/profile navigation resolves authoritative public identities before
  changing screens. Canceled, superseded, or account-mismatched reads cannot win.
  Unavailable destinations have visible retry/back controls instead of silently
  showing unrelated content at the requested address.
- Browser state contains only opaque positions. Screen snapshots are bounded to
  80 history entries, navigation stacks to 64 frames, and account changes clear
  cached screens before they can be recaptured under another account.
- Page titles, canonical addresses, social metadata, and structured data follow
  navigation using a bounded, anonymous, server-authored metadata projection.
  Private pages retain noindex and do not inherit another page's structured data.
  Metadata is parsed inertly and copied through an allowlist, never inserted as
  executable HTML. The endpoint has path/response limits and rate limiting.
- Server-owned collection filters and pagination remain intact. Their boot guard
  completes immediately; they no longer wait for an eight-second watchdog to
  reveal already-rendered content. These routes still use full document links.
- Eligible events whose title is not a catalog artist can show their independently
  validated date, venue, and ticket details. This does not unlock artist features,
  expose member posts, or bypass protected artist/memorial rules.

## Verification

`npm run check` passed: 4,665 tests, zero reported production dependency
vulnerabilities, syntax checks across 580 Node files, architecture checks, and the
production web export. Initial JavaScript is 507.4 KiB gzip, within the existing
512 KiB budget. No baseline was expanded to admit new architecture debt.

The exported build is also exercised by `verify:navigation-browser`,
`verify:auth-browser`, and `verify:auth-real-server`. The first two use local-only
API fixtures; the real-server suite uses a disposable database and real HttpOnly
cookies with provider traffic blocked. Navigation and auth browser regressions
are now included in GitHub CI.

Final exported-build results: 36/36 navigation browser scenarios and 52/52 auth
browser scenarios passed, across mobile and desktop viewports. Together with the
12 real-server checks below, all 100 browser/server smoke checks passed on
`index-a2ebf4bca5067cca38c515c834725c71.js`.

The real-server suite passed all 12 checks, including account selection/switching,
session revocation, resets, authorization checks, and up to 100 concurrent local
authenticated reads. This is correctness coverage, not a production load-capacity
claim. No production users or provider accounts were used for these tests.

## Boundaries

This repair does not promise immediate Google recrawling, indexing, rankings, or
sitelink changes. It corrects inconsistent page identity and visitor navigation.
It is not evidence that every historical server outage is resolved. No production
account records, access rules, database schema, or hosting settings were changed.
Some filtered/paginated collections intentionally remain server documents until
equivalent client screens exist; removing their server content is not a fix.
