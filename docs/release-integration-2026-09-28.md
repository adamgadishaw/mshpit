# Integrated release — 2026-09-28

## Why the earlier fixes were not live

Render's `mshpit` service deploys `master`, after GitHub checks pass. The audit
commit `cdf456a` and PR #13 head `90ebb0f` existed on separate branches. PR #13
also conflicted with current master. A branch push did not deploy those fixes.
The last observed live revision before this release was `56444f1`; master's
later `84b36d4` was documentation marked `[skip render]`.

This release reconciles the audit with PR #13, preserving live coverage,
supporting-act history, privacy replay, social interactions, video playback,
news scheduling/artwork, and the opt-in Search Growth framework. See the
individual audit and feature reports for their contracts and limitations.

## Integration repairs

- Combined both navigation contexts and news/repost actions, both account-export
  additions, transactional news report ownership, and all scheduler shutdowns.
- Account erasure now clears `created_by` in live-news events, notes and drafts
  while preserving editorial content. Tests cover another editor's records,
  rollback and replay after a database restore.
- The combined startup bundle initially exceeded the unchanged 512 KiB gzip
  limit. A single on-demand import now owns the heavy share editor, preserving
  every sharing control, account/item isolation, cancellation and image cleanup.
  Its loading/error shell stays closable, retries locally and never reloads an
  unsaved page. Optional countdown/news panels have local loading boundaries.
- Final fixture export: **507.0 / 512.0 KiB gzip**. No performance threshold was
  raised. No maps or posting controls were removed.

## Search Console image metadata

Public member ImageObjects now link `license` to `/photo-rights` and
`acquireLicensePage` to `/photo-rights#request-permission`. The public page and
visible gallery links describe existing rights and how to request permission;
they do not grant third parties a new licence or expose private contact data.
The uploader receives a sharing credit, not an unverified photographer or
copyright-owner claim. Separately evidenced catalogue licences are unchanged.

These fields are noncritical enhancements, not indexing blockers. Google must
recrawl before its report can change. Unknown creator/copyright information is
not fabricated merely to remove a recommendation. Reference:
https://developers.google.com/search/docs/appearance/structured-data/image-license-metadata

## Verification and rollout gates

- Final integrated unit suite: **5,830 passed, 0 failed, 1 skipped**; includes a
  fresh Expo export enforcing the startup budget.
- Architecture, Blueprint schema/references, and production dependency audit
  passed; the latter reported zero known vulnerabilities.
- Real exported browser regressions use synthetic accounts/media and blocked
  external traffic. News cases now open/close/reopen the deferred share editor
  on phone and desktop layouts. Physical iPhone Safari remains separate testing.
- The release must pass remote CI, become Render's live revision, and pass
  public health/readiness and the exact affected post's JSON-LD checks. This
  committed note records pre-push evidence, not a claim those later steps ran.

Search Growth stays opt-in and requires protected Google credentials. A code
deployment does not establish that it is configured or importing data. No new
Render service, storage bucket, ad SDK, or extra paid worker was provisioned.
Real backup restore drills and historical Git exposure follow-up remain open
as documented in `SECURITY.md` and the handoff audit.

## Other dependency PRs

The setup-node v7 build-action update is a CI-only candidate, pinned to the
reviewed immutable release; it retains Node 24 and current npm settings.
Hold application dependency PRs #4/#11 (React/DOM exact-version mismatch), #7
(RN outside the Expo 57 / installed Reanimated pairing), #10 (requires a newer
Worklets pairing), and #12 (Skia requires coordinated native/CanvasKit testing).
An open dependency upgrade is not evidence that a production repair was lost.
