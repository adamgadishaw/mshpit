# PC feature follow-up — local candidate

Base: remote master `6a51cb7a79605625602beb91dd7e55e26d3b1455`, verified with
`git ls-remote` on 2026-11-10. Branch: `fix/pc-feature-followup-20261110`.
The isolated clone is under the Codex task workspace. The existing dirty
`D:\Websites\Concert Website\pit` checkout was not edited.

## Behavior

- Post/comment responses project current badge authority and display selection.
  Complete embedded badge bundles prevent stale people caches from restoring
  revoked eligibility. Confirmed profile reads reconcile mounted author caches.
- Page titles and active tabs return the visible page to its top and refresh
  data where the page has a refresh operation. Static forms scroll without
  discarding drafts. Retained hidden screens cannot claim the visible gesture.
- Activity has one history list. Opening refreshes cursor history and sends
  captured unread IDs for acknowledgement. Only confirmed IDs clear locally;
  failures retain unread state and offer retry. Concurrent arrivals survive.
- For You traverses older eligible history after its ranked head. Local has
  a server-filtered cursor feed; Following retains its own eligible cursor.
  All three automatically load on scroll and retain retryable failures.
- Find a Show opens the saved home city. A dismissible bottom prompt opens
  Discover Cities without updating the saved home. Missing or ambiguous homes
  open city selection.

## Preservation and integration

No push, merge, deployment, production/account change, or phone interaction is
authorized or performed. Native iOS builds and device acceptance remain unrun.

This patch does not contain unrecovered Mac combined `7260456`, keyboard
`407aa2f`, messaging `bbae706`, or calendar `c45b153`. Calendar history
`9811851`, `6f077f4`, `1012849`, `c45b153` plus uncommitted screen/attendance work,
its clock loop and agenda pagination, and the messaging acceptance-consent race
fix remain a separate recovery/integration assignment. Do not overwrite them.

Apply this candidate on its recorded base, then integrate recovered work in a
separate branch. Review overlapping App navigation, shared refresh boundaries,
store account scoping, Calendar/Inbox/Thread screens, and test fixtures. Rerun
the full quality gate and native device acceptance after integration.

## Validation

- The complete `npm run check` passed, including catalog split, tests (7,128
  passing, zero failing, one skipped), dependency audit, syntax, architecture
  and web export. The final full-suite rerun after the navigation commit-scope
  correction passed: 7,129 passing, zero failing, one skipped (7,130 total).
- Independent review ran 55 selected tests with all passing; review findings
  about profile-history restart, notification account epochs, feed section
  refresh isolation, and city prompt rendering were corrected.
- Independent final navigation review ran another 23 focused checks, all
  passing, including a real suspended speculative route. Page activation and
  navigation cancellation callbacks now change only after React commits.
- Two browser cases passed at 390px and 1280px against the exported app with
  loopback synthetic fixtures and mocked APIs. They explicitly check feed title
  refresh and active Feed tab refresh, plus tab/history navigation.
  Final reviewed build: `index-2859416092f71292f29b5483badb9b0b.js`.
- Separate dependency audit found zero vulnerabilities; syntax checked 925 Node
  files; architecture and `git diff --check` passed. The web export passed at
  509.7 KiB initial JavaScript against the 512 KiB budget.
- Initial runs during concurrent edits contained transient/fixture failures;
  those runs are diagnostic only and superseded by the final gate.

Task-workspace evidence: `quality-gate.log`, `final-tests-after-review.log`,
`browser-final-reviewed.log`, and `diff-check-final.log` in the parent directory
of this clone. Logs and generated `dist` outputs are not committed.

The history integration fixture covers 65 local and eight remote posts, including
continuation past the ranked per-author cap and blocked-author exclusion. A
2,505-post projection stress run was interrupted and is not a performance claim.
Large-history performance remains unverified. For You retains the existing
in-memory snapshot lifetime; expired/restarted snapshots require an explicit
page refresh instead of silently changing ordering mid-pagination.
