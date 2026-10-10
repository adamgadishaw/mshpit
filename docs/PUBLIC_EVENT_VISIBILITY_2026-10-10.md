# Public event visibility correction — 2026-10-10

## Scope and release state

This local review branch starts at released commit
`ceab0d50b82c6a9fa88e13e8f79c7e2462948114`, source tree
`3ef3786adb2635e359abd91d59645b6b273a57b0`. The owner approved the focused
confidentiality correction and synthetic regression tests. No production
private records were retrieved or probed, and no deployment or exploitation
finding is claimed. Earlier affected releases have not been attributed.

## Root cause and correction

`GET /api/resolve?path=/event/<exact-id>` calls `resolveEntity` in `server/seo.js`.
Its `publicEventIdentity` query checked release timing, account activity and
event eligibility but omitted the shared artist-authored visibility predicate.
An exact-ID lookup could therefore return a public event snapshot while the
normal public event document correctly hid the same member-authored event.

The runtime correction is one line: add the existing
`artistAuthoredTourDateVisibleSql("td")` predicate to `publicEventIdentity`.
Its default anonymous scope applies to all public resolver callers, including
the event owner, admins and moderators. Authorized private calendar reads keep
their existing permissions. Provider-owned events remain eligible under the
existing provider identity and publication rules. No records are changed.

The synthetic disclosure concerns event/artist names, venue/place, schedule,
ticket and source identity fields. The public projection does not include
owner IDs, email, passwords, sessions or private account coordinates. The
finding requires a known exact event ID; enumeration and production
exploitation were not tested. The broader synthetic account assessment passed
158 existing and 19 supplementary valid-session cases without another finding.
Its earlier four-case/no-fix-authorized checkpoint is historical and is
superseded by the later owner approval and eight failing pre-fix cases below.

The returned categories could include event title and kind, artist name and
key, venue and place/city, date/time/timezone/status, ticket URL and sold-out
flag, provider/source identifiers and canonical path. The snapshot projection
does not include owner ID, email, password, session or account-location fields.

The runtime correction adds `artistAuthoredTourDateVisibleSql("td")` to that
query, reusing its existing import and the default anonymous/public scope
already applied in `server/features/seo/publicDocumentRepository.js`.
Unknown and restricted IDs both resolve to `null`; the API returns
`{ entity: null }`, and the public document plan returns 404. The public resolver
does not grant additional access based on the caller's session or staff role.
Existing authenticated calendar and management permissions remain separate.

The predicate covers the current ownership, publication, profile-audience,
identity-review and active-account rules. It retains independent provider
events (`owner_id IS NULL`) as public facts. No SQL write, migration, dependency,
artist matching, provider call, cache, deadline, credential or setting changes
are included.

## Regression evidence

`server/artistAuthoredTourDateVisibility.test.mjs` now checks exact resolver,
public document and SEO-plan agreement and exercises both `/api/resolve` and
`/api/tourdates` handlers with current synthetic anonymous, unrelated member,
owner, admin and moderator contexts. These are route-handler tests; they do not
replace independent cookie/session-boundary tests.

The 14 new scenarios cover everyone and approved-identity public controls;
only-me and members-only audiences; pending/rejected member-created identities;
pending/rejected imported-catalog identities; removed profiles; withdrawn
ownership; banned, suspended and dormant owners; and an independent provider
event despite a private, removed, rejected member profile.

Running those regressions before the runtime fix produced 6 passes and 8
failures, each failure demonstrating a restricted event exposed by exact-ID
resolution. Banned/suspended/dormant owner controls were already denied. With
the fix, the following focused suite passed **29 tests, 0 failures/skips**:

```text
node --test --test-concurrency=1 server/artistAuthoredTourDateVisibility.test.mjs server/publicEventSnapshotResolution.test.mjs server/profileAudience.test.mjs
```

Validation used temporary synthetic databases and the review-only loopback
network guard, not production data or providers. Existing snapshot cases retain
provider identity safeguards, event eligibility, memorial rules and public
provider results without a stored artist.

## Independent and complete validation

Independent review passed 24 focused cases with no blocker. The production
predicate and test hashes matched the author's frozen source. Anonymous,
unrelated member, owner, admin and moderator controls all retain public-only
resolver scope; independent provider events and authorized calendar reads pass.

The earlier combined candidate's complete checks are historical evidence only.
They included a separate abuse-hardening experiment and do not establish the
validity of this smaller release candidate. Fresh focused and full checks on
`review/privacy-diagnostics-alerts` are recorded in
`ACCEPTED_CORRECTIONS_REVIEW_2026-10-10.md`. Provider deadlines, identity
matching, existing admission behavior and client error codes remain unchanged
by this accepted-only composition.

## Remaining release gates

The owner authorized local preparation and testing. Publication requires a
separate release decision, current exact-commit CI and deployment verification.
The coordinating review retains this correction separately from diagnostics
and the page-admission experiment, whose performance acceptance remains open.
No local commit, push, merge, service restart or deploy occurred here.
