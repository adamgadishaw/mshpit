# Signed-out You page crash — September 8, 2026

## Confirmed incident

The 16:27 Toronto alert included a new report with request ID
`5109467a-5745-47b2-a3cb-cd4518321a6f` and cause
`RenderError.Web.Type/b8sfj9muwud8xhpoggog04wku4.1.1fk`.
The safe location decodes to the exact deployed asset
`YouScreen-94783d6efe4a506b32e392129254b57c.js`, line 1, column 1856.

That location dereferences `memorySelection.memory` in this expression:

```js
memorySelection?.accountId === session?.id ? memorySelection.memory : null
```

When both selection and session are absent, the two optional accesses return
`undefined`; the equality succeeds, and the consequent dereferences null. This
runs before the screen's existing logged-out return. Guest navigation from Events
to You reproduced the same location and `/client/landing` classification at both
390px and 1280px. Direct `/you` navigation also reproduced it, classified as You.
The generic landing classification is URL-derived, not the component name.

The earlier `6d77b04d-5334-45f8-87f9-8fab09b78e05` report was also included in the
new digest. Its original exception was not recorded; do not assert it was the
same underlying defect. Two displayed kinds did not mean two new crashes.

## Correction

`selectedConcertMemoryForAccount` requires a nonempty current account ID, an
existing selection owned by that exact account, and an object memory before
returning it. Missing sessions and account switches return null immediately,
before effects, so the modal and archive gallery cannot use a prior account's
selection. No account records, posts, uploads or credentials are changed.

An existing source-pattern test had explicitly required the faulty expression.
It now checks wiring to the account-scoped selector; executable selector and
screen-render regressions cover the missing-session behavior and account changes.

## Traffic interpretation

The crash was reproduced locally with mocked requests and a single browser. No
traffic load is required to trigger it. Production home, health and readiness
checks returned HTTP 200 during investigation, and the previous diagnostic build
was being served. These point-in-time checks are not a traffic capacity test and
cannot establish historical CPU, memory or request volume on Render.

## Verification

Use an isolated browser with all writes intercepted: open `/you` logged out, and
open Events then select You, at phone and desktop widths. Expect the logged-out
screen, no crash boundary, no crash telemetry and no archive request. Also verify
a signed-in member can open You and log out, and that a previously selected
memory is not exposed when the account becomes absent or changes.

All six mobile/desktop built-app navigation scenarios passed against corrected
`YouScreen-1de0b70c71a3298a71250738167e7525.js`: no browser exceptions, crash
reports or recovery boundaries. Guest archive requests remained disabled. Before
the correction, all four guest scenarios reproduced the production coordinates.

## Duplicate digest correction

The old email query rounded the previous delivery time down to an hourly bucket,
so a later digest could include an already-reported error with its unchanged
request ID. Its delivery checkpoint also disappeared on process restart.
The replacement records acknowledged occurrence counts and the last successful
delivery persistently, and retries a frozen batch with a stable delivery key.
Arrivals during email delivery remain pending rather than being marked sent.

Legacy rows contain no exact delivery history. The upgrade baselines older
history and may send a labelled initial catch-up for recent faults once; it does
not erase the incident ledger or silently assume recent faults were delivered.

## Release checks

The complete release check passed all 3,528 tests, syntax and architecture checks,
the production dependency audit (zero vulnerabilities), and the production web
export. Initial JavaScript remains 487.8 KiB gzip within the 512 KiB budget.
The executable screen regression was also checked against the original expression
in memory: both logged-out startup cases failed with the reported null-memory
TypeError; the corrected source passes. No production alerts or email were sent
by the regression tests.
