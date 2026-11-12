# PC native, features and copy integration

The frozen reviewed PC feature source is
`7243c5797e44e112769bdf45ab71278cb1900c64`, tree
`278aa6daa9bd33566e8e4b9c897ea0dd7367f804`. It remains unchanged in its
original isolated checkout and handoff. This separate candidate starts there.

## Copy input and reconciliation

Copy commit `6c782dfa7c1a279264d3f89b5c2bec4581750b51` has the shared
PR #98 base `2b0151a448e8f29affb5d7e3b0052a3adc3e2cd5` as its parent.
Its bundle SHA-256 is
`0b8bbcbfaa7517e4388c363ac663ef5b852701702fe406f7041c82aff9b2b97b`.
The bundle and prerequisite were verified locally before merging.

The 53-file input (39 runtime source files) overlaps the PC feature delta in
five files: `scripts/verify-auth-browser.mjs`,
`scripts/verify-navigation-browser.mjs`, `src/components/NearbyAfterparty.jsx`,
`src/lib/errorCatalog.mjs`, and `src/screens/ShowScreen.jsx`.

- Preserve the newer after-show component in full. Its missing-map-location
  explanation and official-directions advice supersede the copy hunk targeting
  the old component; no old controls or location assumptions are restored.
- The concert setlist spoiler wording is already present verbatim, so there is
  no additional ShowScreen change in this copy merge.
- Apply the other wording changes to current code, keeping the extra link-error
  entry and every error code/category/severity/failure point/retry policy.
- Adapt the newer event-account browser verifier's feed text locator to the
  changed copy; preserve its sign-in/return and authorization assertions.

The copy merge changes 37 runtime files. Comparing parsed structures with
only literal/JSX/template text normalized confirms unchanged executable
structure. All 38 current error policies match. The 78 focused copy, account
form, error catalog and after-show tests pass. These checks do not establish
combined native compatibility; final combined gates remain required.

## Native input and boundaries

Expected exact Build 8 source:
`31860b2d080805bfef1da3e29d38400cbd85b5d7`. The native owner reports that
PR #98 was integrated onto the existing Mac lineage rather than retained as a
direct ancestor. Import and compare the verified portable source before
selecting merge resolutions; a Mac/cloud path does not establish PC receipt.

Preserve Build 8's themes, native UI, recovery and navigation, including its
distinct pure startup-helper filename and actual Metro iOS/Android/web
resolution regression. Do not reconstruct or substitute the startup repair.
Preserve the PC's independent scores, long reviews, legacy text/precision,
media/draft/retry protections, privacy, calendar/follow/withdrawal guards, venue
search and full-review overlay. The startup cap remains 524,288 gzip bytes.

Discover research is not integrated feature source. Country rankings currently
use artist origin, not listener geography. Do not enable Billboard/Luminate or
Apple chart ingestion without verified display and derived-ranking rights.
Activity notices do not implement device push/email. Final source review and
Mac native validation remain required; no production release, publication or
phone operation is authorized by this local integration.
