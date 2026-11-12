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

Verified exact Build 8 source:
`31860b2d080805bfef1da3e29d38400cbd85b5d7`, tree
`dd30b8185664e4acfb2c4e94af11e507e04e6a47`. The source-only ZIP was retrieved
read-only from the existing private handoff and verified on this PC: 24,097,391
bytes, SHA-256
`f039f6ef0cca4848a414e6114b77f67479f31be40bf318614c9289006b63c45c`.
The included package verifier passed, and an independent local clone of its
standalone bundle matched all 3,053 tracked files against the supplied source
manifest. No signing credentials, user data, or Mac caches were imported.

PR #98 is not an ancestor of Build 8. Git confirms the real merge base is
`6a51cb7a79605625602beb91dd7e55e26d3b1455`. Compared with the PR #98 content
checkpoint, the native input changes 755 paths and the PC/copy input changes
248, with 52 overlapping paths. The merge uses the real histories. PR #98
content comparisons help identify duplicated work, not invent ancestry.

The 39 initial Git conflicts are resolved. Sixteen were exact-content cases
where one side still matched PR #98; both-changed files were reconciled
explicitly. In particular, preserve PC database upgrade/venue history and
creator/calendar/private-withdrawal transactions alongside native database,
badge, notification and message recovery. The renamed Discover venue component
keeps city search, stable input identity, canonical venue identities and native
view-state restoration.

Platform-specific files require implementation beyond shared-file merging.
The iOS Show, Post, Artist, Festival, TicketStub and after-show implementations
now carry the reviewed feature contracts while preserving native typography,
retained detail admission, privacy projection, keyboard/comment ownership and
recovery. The native calendar and feed structures remain intact; native Feed
continues to consume shared FeedContent. Show event controls still require the
server-readable canonical event ID; archive IDs are never claim targets.
Creator/follow controls and disclosure triggers retire native callbacks when
covered and after Back, without clearing authored request text.

The Root review modal wraps the retained native detail composition. Its actual
origin and comment draft survive a gallery child, while account changes clear
the previous presentation. Background content is hidden from accessibility.
The independent author score and profile aggregate semantics remain separate.

The first combined export exceeded the 524,288-byte web startup cap by 4,306
bytes. Web attendance-ticket presentation now has one deferred entry shared by
the feed and ticket composer; native keeps its synchronous component. Small
web layout/ticket-opener adapters avoid shipping unused native typography and
speech/lifecycle logic. Actual Metro iOS/Android/web resolution tests verify
these adapters and the original startup repair. No budget is raised and no
native startup ordering is changed.

Initial reconciliation evidence: 130 focused native integration checks,
1,021-file Node syntax check and architecture checks pass. These are preliminary
source checks; final immutable-source aggregate, browser, budget, platform
exports and independent review receipts belong in the external handoff.

The first aggregate on merge checkpoint `e49232e8` exposed two native
presentation regressions: the creator Activity merge restored the retired iOS
mode tabs, and a cancelled public event hid independent artist recovery. Restore
the chronological iOS Activity list (including creator notices) and keep artist
recovery reachable without enabling cancelled-event tickets. The relevant real
component tests cover both corrections.

Update integration harness imports and bindings to the current lazy components,
review presentation, consent helpers and renamed venue component. Venue return
tests now exercise the actual 12-row pagination while preserving selected city,
search, selected venue, expanded shows and account/preview isolation. Preserve
the original complete non-iOS card snapshots with only the intentional review
permalink wording exempted and explicitly asserted. Browser fixtures follow the
canonical profile route, account-target reads and independent rating labels.
Normalize this isolated checkout to Git's LF blobs for exact-source native
snapshot checks; this does not change tracked source contents.

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
