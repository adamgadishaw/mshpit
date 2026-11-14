# App copy review — November 11, 2026

This local copy branch starts at the verified database/theme review candidate
`2b0151a448e8f29affb5d7e3b0052a3adc3e2cd5`. It does not merge, publish, deploy,
change account permissions, or alter layouts. The active database checkout is
untouched. Branch: `fix/app-copy-20261111`.

## Voice and scope

The existing landing promise, “Remember every show,” and the concrete concert
actions are the reference: find a show, log it, rate the artist and venue, and
share a review or photos. Keep that music context without turning errors,
account deletion, or empty states into concert metaphors.

An app-wide inventory scanned 1,169 JavaScript/JSX source files, excluding tests
and bundled seed content. Manual review covered primary account, onboarding,
discovery, feed, profile, archive, social, media, notification and error copy,
plus shared domain wording and public-page defaults. This is a targeted source
pass, not a claim that every stored or generated string has been rewritten.

The patch updates wording across 39 source files.
Existing copy assertions and browser selectors are updated for changed text.
No dependencies, identifiers, routes, interpolation expressions, account roles,
rating logic, privacy controls, error codes or retry policy change. Legal text,
user-generated content, imported artist/venue descriptions, stored editorial
overrides and email templates are not rewritten.

## Representative changes

| Before | After |
| --- | --- |
| Your life's musical journey | Your shows. Your music. |
| Your wristband expired | Please sign in again |
| One last soundcheck | Confirm account deletion |
| The photo booth is full | Too many pending uploads |
| Presets are deterministic starting points. Fine-tune them in Adjust. | Choose a filter, then fine-tune it in Adjust. |
| Confidence-weighted fan ratings reward nights with real community depth, not one perfect score. | Rankings consider both the scores and the number of fan ratings. |
| Reply to accept, the chat then moves to Messages. | Reply to accept the request and move the chat to Messages. |
| Artists you love, your feed, recommendations, and events get built around them. | Artists you like. Your choices help shape your feed, recommendations, and events. |

Onboarding names the current step and explains optional profile setup. Artist
setup links describe creating or claiming a page, without implying that an
ordinary member account already has artist publishing tools. The existing
artist signup choice and verification requirements stay intact. Nothing here
adds venue/event account support before those workers' implementations arrive.

Empty states describe what is available and the next action. Ranking copy keeps
the distinction between scores and rating volume. Upload/playback notices explain
the unavailable operation without exposing implementation terms such as a
“destructive video recipe” or “verified frame-extraction engine.” Diagnostic
references and uncertain email-delivery language remain available.

## Integration boundaries

- `src/screens/ShowScreen.jsx`: exactly one copy hunk, changing the setlist hint
  to “This tour is still running. Tap to reveal the setlist (spoilers).” Apply
  this wording to the event worker's final setlist section; keep their layout,
  independent overall show score, and separate artist/venue scores.
- No edits to `LogScreen.jsx`, composer draft persistence, post creation or
  projection, `NotificationsScreen.jsx`, `ArtistHubScreen.jsx`,
  `RequestArtistScreen.jsx`, `ArtistScreen.jsx`, `VenueScreen.jsx`, `App.js`, or
  `src/store.js`. Do not overwrite those workers' files with this base.
- Shared integration touchpoints include `AuthScreen.jsx`,
  `SignupOnboardingScreen.jsx`, `WelcomeGuide.jsx`, `SettingsScreen.jsx`,
  `EditProfileScreen.jsx`, `menuJourney.mjs`, `MenuScreen.jsx`, and `FeedScreen.jsx`.
  Apply the text hunks to newer logic if those workers also change these files.
- The public-page footer changes in `server/publicPages.js`; its policy bodies,
  routes, metadata and legal disclosures are unchanged.
- After integrating other branches, rerun the quality gate on the combined tree.
  This branch's result cannot establish the correctness of a later combination.

## Copy to reconcile with the active profile/creator workers

These observations are deliberately not applied to their unfinished surfaces:

- Notification welcome text should use “Welcome to Mshpit. Log shows, share
  reviews, and follow other fans.” Existing like/comment labels also need the
  creator worker's final post-kind distinctions; do not label every update a
  review. Keep the Digest scope disclosure accurate.
- Artist HQ currently says “Your photos, live videos, news, and upcoming
  concerts. One account. All free.” Prefer a concrete management description,
  adapted by account kind: “Manage your artist page, posts, and upcoming shows.”
- “Keep the public path from discovery to the door clean” should describe the
  actual controls, such as “Keep your show dates and ticket links up to date.”
- Venue “No released upcoming dates were found on this page” can become
  “No upcoming shows are listed here yet.”
- Artist “The podium is open” and “Photos and songs are on the way” should
  describe the actual empty state rather than promise future data. For example,
  “No rated shows yet” and “No photos or songs are available here yet.”
- Use artist, venue and event as the account's public identity; festival brands
  map to event accounts. An ordinary user's personal profile remains separate.
  Do not describe special account uploads as tools available to everyone.

## Validation

Final results and rendered evidence are recorded in the delivery manifest beside
the worktree. The full suite passed 7,383 tests, with one existing Windows
file-link skip and zero failures. The aggregate command then stopped because the
sandbox blocked npm's advisory endpoint. A separate allowed audit passed with
zero vulnerabilities. The focused copy/behavior rerun passed all 76 tests.

There is no clean, end-to-end `npm run check` result from this environment.
Elevated retries encountered Git's worktree-owner check and intermittent
database coordination timeouts. A process-local ownership exception for this
exact new worktree resolved the Git issue; no global settings changed. The
follow-authorization, repository-privacy and verification-recovery rechecks
passed 20/20. A later run limited its shell to four CPUs but timed out in the
comment-delivery race test and stopped making progress; it was interrupted.
That entire test file then passed 20/20 on its own, including the two-writer
race. No test assertion, timeout, production behavior or bundle limit was
weakened to obtain a pass. The combined integration tree still needs its gate.

All nine existing browser form cases passed: mobile and desktop login/signup,
password reset/change, connected accounts, data export and owner decisions.
The additional visual harness captured eight screens at both 390 and 1280 px:
feed, menu, welcome, settings, both profile-setup steps and both account-deletion
steps. It found zero page errors, horizontal document overflows or unexpected
API mutations. Representative mobile and desktop captures were visually
inspected. The production web export passed; initial JavaScript measured
508.2 KiB gzip against the unchanged 512 KiB limit.

The standalone syntax check passed for all 954 Node files. Architecture and
Render Blueprint checks passed. Both staged and unstaged whitespace checks
passed. The Blueprint result validates its schema and references, not live
service synchronization or secret configuration.

The external AST comparison parses every changed source file and compares it
with the candidate after removing only literal string values, JSX text and
template text. It verifies unchanged executable structure and interpolation.
Rendered checks use the exported web app, synthetic accounts, loopback API
fixtures and blocked external requests. They do not validate native iOS/Android,
production services, stored copy overrides, or other workers' new screens.

There is no separate lint or TypeScript command in this JavaScript repository.
The required gate includes tests, dependency audit, server/script syntax,
architecture checks, Expo production web export and the existing bundle budget.
