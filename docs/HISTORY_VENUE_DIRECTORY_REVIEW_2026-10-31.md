# HISTORY venue directory identity review — 2026-10-31

Base: master 91cef8b9eabe2a97d3e7daf255dad67ec406e809, verified against origin before publication. Branch: astra/venue-directory-identity. This is a draft review candidate, not release approval.

## Problem and change

Toronto city browsing previously reduced venue rows to display facts via allVenues(), then attached an alias-aware name count. HISTORY could therefore advertise upcoming shows while opening the empty name-only route. City grouping now consumes the same bounded venueSearchIndex as search. It retains identity, source, providerVenueId and each row's own upcoming count; directory totals sum displayed rows.

The pure venueDirectoryGroups helper does not join providers, invent coordinates, broaden server matching, or alter allVenues consumers. Current provider alias safeguards and the eight-event public preview remain unchanged. Direct /venue/history alias resolution is outside scope. No UI/theme, server, database, dependency or workflow configuration changes are included.

## Review

An independent agent inspected the production change and tests. It found no production-code defect and one P2 browser assertion weakness: sidebar text could satisfy a venue-detail assertion. The verifier now opens Shows and awaits snapshot-only performer text after both city and search navigation, with absent empty/error states. The reviewer re-inspected the correction and reported no remaining actionable finding. This is agent review, not a GitHub approval.

## Validation and limits

- Focused client venue grouping/search/URL/public-snapshot selection: 50 passed.
- Additional server public venue snapshot/provider identity selection: 17 passed.
- Late hydration and changed tour-date snapshots are covered; separate provider rooms/cities, opaque Ticketmaster case, curated anchors, missing coordinates and visible counts retain their contracts.
- Corrected browser verifier passed both widths and uses the actual export at 390px and 1280px, mocked loopback API fixtures, and blocked external traffic. It checks delayed hydration and both directory navigation paths. It does not test a physical-device pull gesture or live production inventory.
- Full npm run check is not green: the two festival failures reproduce on untouched exact base (9 passed, 2 failed in focused baseline). The first-cycle lineupChangedAt assertion expects null but receives a timestamp; downstream Festival structured data contains 3 performers instead of 4. No festival correction is imported from PR81.
- Syntax, architecture, Blueprint, production dependency audit and web export are checked separately because the aggregate command stops at tests. Final command outcomes are recorded in the draft PR description.
- No migrations or production data operations are needed. No merge, auto-merge or deployment is authorized.

### Final publication recheck

The combined focused selection passed 65/65 (the earlier 50- and 17-test
selections overlap by two tests). The corrected exported-app browser passed
both widths and both navigation paths, with two snapshot reads per width.

Fresh aggregate: 7,074 tests, 7,065 passed, eight failed, one skipped. In
addition to the two known festival failures, four follow-lock coordination
timeouts, one HTTP recovery readiness timeout and one venue-map body-deadline
assertion failed. All 29 tests in those three additional files passed in an
isolated rerun. This does not replace a passing aggregate run. No timeout,
assertion or test skip was relaxed. Production dependency audit and Blueprint
validation passed. The new standalone browser verifier is not wired into CI;
its result is local evidence, separate from the existing GitHub browser suite.
