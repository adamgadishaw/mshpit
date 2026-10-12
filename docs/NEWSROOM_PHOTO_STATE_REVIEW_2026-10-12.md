# Newsroom photo delivery and composition reset

Local candidate on `fix/newsroom-photo-state-20261012`, based on verified remote
master `81e63f7753b92d338f5707f33a40316d49638294`. No push, merge or deployment.

## Cause and scope

The anonymous NCT WISH post response retains its ready image descriptor; its
server HTML also includes the same image. A read-only browser visit to all three
reported public examples loaded their photos successfully (HTTP 200). No storage
loss was found. The trigger for the owner's intermittent delivery failure was
not captured during those visits.

The client used Expo Image directly without recovery. The installed Expo Image
web animation manager removes an errored image node from the DOM. Parent refresh
with the same source does not retry that node. A loopback regression against the
unchanged live source reproduced the silent missing image after one injected
503: article text and sources remained, but the photo never recovered.

`NewsPhoto` remounts the original image once after a load error. A second error
shows a bounded, accessible manual retry control. URI changes reset delivery
state; late callbacks from earlier attempts cannot exhaust a replacement. No URL
rewriting, proxy integration, API change, schema change, security relaxation or
generated-news setting change is involved. Existing photo dimensions and fits
are retained in the composer, saved-draft preview and public news cards.

The composer previously marked a successful payload saved but retained every
field and citation row. Reusing it could carry sources 2–4 into another article.
Confirmed saves now clear all fields, photo metadata and local retry identity.
Uncertain/failed saves retain their content and idempotency key. Edits made while
a request is in flight are preserved rather than cleared by its older response.

## Validation

- Baseline browser checks failed for transient image recovery and confirmed-save
  reset before the candidate was built.
- Focused Node suite: 32 passed, zero failed. Includes delivery retry fencing,
  four-source reset, retention/idempotency, editor API, actual publishing HTTP
  persistence and SEO projection coverage.
- Required `npm run check`: Node suite 6,245 passed, zero failed, one existing
  Windows skip (6,246 total), 84.465 seconds. It then stopped at the unreachable
  npm advisory endpoint. The production dependency audit is unverified here.
- Remaining gates executed separately: syntax passed (849 Node files), unchanged
  architecture debt passed, final production web export passed, initial bundle
  507.5/512 KiB gzip. `git diff --check` passed.
- Newsroom browser: four isolated mobile/desktop cases (390/1280), including
  uncertain save/retry, lost-response identity, navigation retention, one and four
  citations, confirmed blank reset, second article with independent evidence,
  saved photo decoded at 320px, and reopened preview.
- News browser: six isolated cases across 390/1280, including hydrated deep links,
  feed/navigation, transient recovery, two-request permanent-failure bound,
  manual recovery and reload. Both suites passed; screenshots were inspected as
  actual pixels in mobile draft preview and desktop article.
- An additional return-to-feed assertion initially used the wrong button label
  (`Back`); the actual article control is `Leave the story`. After correcting the
  harness selector, both affected feed cases passed. The same six-case run's
  other four cases had already passed. Failure logs are retained, not overwritten.

All writes in browser tests hit synthetic loopback fixtures. External requests
were blocked except the separately authorized anonymous read-only public check.
No production articles or source metadata were changed. No authenticated/live
Newsroom QA or native-device QA was performed.

## Coordination and release limits

The other attached feature/layout/artist-access checkouts were clean at inspection
and were not edited. The prepared Terms/shutdown release remains untouched.
Local coordination notes describe older Claude catalog/research activity; they
do not prove Claude's current scope. No contact with Claude occurred. The candidate
does not modify shared `App.js`, server routes, Media API or enrichment settings.

The owner must review the patch and test results before any push. A successful
fresh dependency audit and normal final-head CI remain release gates. No migration
or production-setting change is required.
