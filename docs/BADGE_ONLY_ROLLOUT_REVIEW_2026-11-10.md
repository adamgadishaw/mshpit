# Narrow badge backend rollout review

This is a local, reviewable candidate only. No push, merge, deployment, production profile write, or phone action is authorized or performed here.

## Exact source scope

Runtime candidate: `8392e3d38281be8234e626bda3b92e3c2d982e26`, directly on production reference `9c9a4ebe422030f421b17ec2cb4ca2ca3e67546f` (notification release). The parent independently rechecked that GitHub master and Render's live deployment `dep-dbphtiq9lscs73baotgg` both reference this base before candidate preparation. Recheck again before any later release; this document is not evidence of a future deployment state.

Exactly six runtime files change:

| File | Purpose |
| --- | --- |
| `server/api.js` | Merge explicit `extras.profileBadges`, retaining the meaningful empty array. |
| `server/db.js` | Project the cosmetic preference and advertise support only on self responses. |
| `server/profileExtras.js` | Validate the bounded badge preference alongside existing extras. |
| `src/domain/profileBadges.mjs` | Canonical selection and intersection with earned badges; shared pure helpers. |
| `src/domain/dataPolicy.mjs` | Retain valid cosmetic preferences in the public cache without self-only capability. |
| `src/screens/ProfileScreen.jsx` | Apply the preference to the profile name's badge row for web/Android viewers. |

Two test files add coverage: `server/profileBadgeSelection.test.mjs` and `src/domain/profileBadges.test.mjs`. This review document is the only additional documentation change. Store, App, profile editor, packages, lockfiles, CI, notification implementation, media pipeline, native projects and signing remain byte-for-byte at the base.

The public website has no badge-selection editor, so website Store mutation support is unnecessary. The separately prepared native client already owns capability-gated editing and exact confirmed-save receipts. Its newer modules are not copied into this website branch.

The previously reviewed broader candidate `cc3d00c` remains preserved, including all 166 exported artifact hashes. This narrow branch does not include any of its four prepared profile commits:

| Excluded commit | Unrelated changes excluded from this rollout |
| --- | --- |
| `2a0da197` | Sparse legacy-profile saves, explicit bio clearing, editor validation and regression tests. |
| `153a7302` | Compiled profile-edit browser regression, CI wiring, test-script alias. |
| `520659fa` | Profile suggestions, signup review/error handling, guidance components and browser updates. |
| `f460b6c` | Cleanup of that test alias and its CI invocation to avoid an unrelated verifier rebuild. |

None is a dependency of badge persistence or viewing. Their existing fixes remain separate release work; this narrow rollout must not be described as deploying them.

## Contract and dependency closure

Missing/null preference shows current and future earned name badges. `[]` hides them; a valid explicit list selects only currently earned badges. Unknown, duplicate and malformed values are rejected atomically. Preferences cannot award status: role, verification, membership, sponsorship, custom awards and achievement inventory stay authoritative. An unearned known ID may be stored but never renders unless it is actually earned.

Self responses advertise `profileBadgeSelectionSupported: true`; public/cache projections omit this capability and private account data. Viewers intersect the preference with current eligibility, so revoked awards disappear. This is a cosmetic name-row feature, not a promise that badge status is private elsewhere. Older installed viewers continue showing all earned name badges.

The new server validator and the shared viewer/cache import `src/domain/profileBadges.mjs`; it imports the existing `src/domain/badges.mjs` catalog. No package or lockfile change is needed. Publish this complete dependency closure, not just the three server files. Native runtime code is a separate artifact and is not part of this patch.

## Migration and rollback behavior

There is **no schema or startup data migration**. Preferences use the existing users.extras JSON envelope and are written only by authenticated, valid PATCH requests. Existing profile audience, block, verification and account mutation checks remain in place. Existing clients can continue ordinary profile saves; tests execute the unchanged website Store against the real API and confirm that selections and public cache entries are retained.

A rollback to `9c9a4eb` is **not preference-lossless**. It initially leaves existing database JSON untouched, but its older extras schema drops the unknown profileBadges field during a later unrelated extras save (for example, changing pronouns). Its viewers also ignore badge selection. Do not describe an old-binary rollback as preserving badge-display preferences indefinitely, and do not restore the whole database to undo this feature: that would risk unrelated legitimate writes.

With cached capability=true after a rollback, the prepared native client may attempt a badge PATCH. The exact old server rejects a mixed badge+bio request with HTTP 400 before any write; the client reports failure without optimistic success and retains the draft. A fresh old-server self response removes the capability, hides controls, and ordinary saves remain available. Separate disposable rollback fixtures prove both this atomic rejection and the preference loss on a later extras save. If preference continuity is a mandatory rollback condition, require a separately reviewed forward correction that retains the bounded schema; no feature-flag architecture or additional rollback code is included here.

## Verification and release gates

- Focused tests: 13/13 passed, including real SQLite persistence, fresh self/public reads, atomic malformed rejection, custom-award/status preservation, actual profile JSX rendering, and unchanged Store/API/cache compatibility.
- Web export: passed at 516,445 / 524,288 initial JavaScript gzip bytes (7,843 bytes headroom), without paused-player UI leakage. All 702 project source modules across emitted maps match frozen runtime source exactly.
- Architecture: passed.
- Full suite: 7,092 tests ran; 7,086 passed and six HTTP fixture parents failed before startup because their filtered child environments used `/tmp` while the parent used the macOS user temp directory. All six failures contain that exact assertion. Rerunning only those six fixtures on unchanged source with `TMPDIR=/tmp` passed **13/13 checks**, including seven nested checks that startup had prevented. No unresolved test failures remain; both runs are preserved rather than presenting the initial run as green.
- Syntax: passed for 922 Node files. The final receipt is `.tmp/badge-validation/final-verification.json`. Runtime and exact-file hashes remain unchanged after all checks.
- Separate exact-9c9a rollback compatibility: 3/3 passed; evidence at `/Users/adamgadishaw/Documents/Codex/2026-11-10/task-2/evidence/native-feedback-review/badge-rollback-9c9a.log` and its adjacent `rollback-9c9a/server/reviewBadgeRollback.test.mjs` fixture. These are synthetic accounts and disposable databases.

Candidate evidence is under `.tmp/badge-validation/`: focused/full test logs, web export and budget, `web-export-verification.json`, and `scope-preservation.json`. No results from the broader candidate are substituted for this exact runtime's checks. A full hosted-environment suite, remote protected-branch CI, approval of this exact diff and rollback caveat, fresh master/live checks, backup/readiness checks, deployment and post-deployment checks remain separate release gates. No production profile writes are needed for this review.
