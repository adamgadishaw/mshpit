# Handoff implementation audit — 2026-09-28

## Scope and release distinction

Reviewed the supplied Claude/Codex handoff against actual source, not just the
completion messages. The original checkout was behind the remote and contained
an unrelated untracked audit. It and Claude's worktree were left untouched.

- This branch starts at `origin/master` commit `84b36d4`.
- PR #13 (`codex/social-privacy-player`, base `e71c6bb`) was still open,
  unmerged and reported not mergeable when checked. Its additional social,
  media-player and Search Console features therefore must not be described as
  deployed solely because they exist on that branch.
- Small PR #13-specific client fixes are on that branch separately. This patch
  does not merge its larger feature set into master.

This is a source, test-fixture and local-build audit. No production database,
Render settings, storage buckets, paid model calls, publisher feeds or user
accounts were changed. There was no live restore drill or iPhone acceptance
test. Passing tests do not certify the absence of other security defects.

## Confirmed defects and repairs

| Area | Confirmed failure | Repair and regression coverage |
| --- | --- | --- |
| Restore privacy — high | Invalid/unreadable journal entries could be skipped and a successful replay receipt saved; a later startup could trust that incomplete receipt. A 200 HTML/error response could look like an empty listing. | Validate the complete journal before mutation; refuse malformed listing shapes, unreadable objects, bad signatures and conflicting duplicate IDs. Version verified receipts and require older success receipts to be rechecked. Stream bounded bodies; cap pagination and reject token loops. Account-erasure/consent integration tests exercise real transactions with fixtures. |
| News network boundary — high | DNS was checked once and then independently resolved again by `fetch`, leaving a checked-address/connected-address gap. Waiting for DNS was not covered by cancellation. | Native HTTPS connects only to vetted public answers, retaining the original Host/SNI and certificate verification. Recheck each same-site redirect; bound DNS/socket/body duration, headers and both compressed/decoded bytes. Fake DNS/socket tests cover rebinding, private destinations, redirects, compression and cancellation. |
| News publication integrity | A story could commit before its draft status update failed. Concurrent/manual drafts could reuse or reassign already-published source reports. | Recheck source ownership inside the publication transaction; save pasted sources durably; commit story, post, report claims and draft status together. Failure injection proves rollback and safe retry. Previously incurred model spend remains accounted for. |
| Live coverage integrity | A bad replacement nominee could remove the previous winner announcement before validation failed. Moderation audit failure could return an error after a live mutation committed. | Validate first; use composable synchronous savepoints for winner/category mutations and the live route's mutation, audit and response read. Cover every live write route, winner replacement/clear and rollback. |
| Manual editor audit integrity | Draft save/publish/discard could commit before its moderation audit failed, returning an error despite saved changes. | Commit the audit with each synchronous mutation. Article fetching and model calls remain outside transactions; already-settled paid receipts survive a later persistence failure. Tests inject audit failures for written/declined drafts, publication and discard, and prove rollback and retry. |
| Worker lifecycle | Seven scheduler handles were discarded. The news desk also started a separate unowned live timer; it lacked the regular pass deadline. | Retain and stop/abort all seven worker handles before database closure. News owns both timers and live ingestion receives the same bounded admission/deadline. Regression tests execute actual shutdown ownership code. |
| Playback resource leak | Expo web's time-update interval survived player/view cleanup, accumulating timers over repeated opens/retries/swipes. | Explicitly clear the owned interval before listener cleanup, including already-released native players. Tests execute the installed Expo web implementation and actual component effects across repeated lifetimes. Applied to current master and PR #13's extracted player. |
| Artist counts and links | Equal display names could merge two different known artist IDs. Repeated same-night opener records inflated times-seen counts. Boolean/array values were coerced into numeric counts. | Known IDs take precedence; only missing-ID legacy rows use name fallback. Deduplicate dated opener sightings while retaining separate unknown-date records. Reject non-number/non-string input on client and server. |
| Following feed — PR #13 only | A completed social mutation during pagination lost its refresh request; expanded feed histories could remain stale indefinitely. | Coalesce one refresh after the in-flight request. Discard queued refresh on logout, account/privacy scope change or unmount. No extra polling or unbounded request queue. |

No maps or posting controls were removed, no new paid worker fleet was added,
and no publication or model-spend limits were raised.

## Verification

- PR #13 client follow-up: **5,736 passed, 1 skipped, 0 failed**; syntax,
  architecture, Blueprint validation and production web build passed. Initial
  JavaScript: **511.9 / 512.0 KiB gzip**. Pushed as `90ebb0f` to the existing PR.
- Latest-master branch: **5,646 passed, 1 skipped, 0 failed**. Production web
  build passed at **510.1 / 512.0 KiB gzip**; syntax, architecture and Blueprint
  validation passed. The final editor files were separately syntax-checked and
  the architecture gate rerun after their source freeze.
- `npm audit --omit=dev --audit-level=high`: **0 known vulnerabilities** at the
  time of this check. Both audited branches used the same package-lock.
- Tests used temporary fixture databases and fake provider/model transports.
  Blueprint validation does not prove live Render sync or configured secrets.

## Operational follow-up still required

1. Deploy only the reviewed/merged branch and verify its actual release SHA.
   An unmerged PR is not a production fix. PR #13 needs a separate conflict
   resolution/integration review; this audit does not silently merge it.
2. Run an isolated restore drill against the real private backup/journal
   configuration. Shipping is attempted every five minutes in batches of 50,
   not guaranteed delivered within five minutes. Backlog/outages can extend the
   loss window. See `SECURITY.md` for replay, key and retention requirements.
3. Preserve historical journal verification capability and tombstones while
   any corresponding backup, local copy or pre-replay startup snapshot can be
   restored. Individual content deletions and block/restriction changes still
   need separate reconciliation. Large journals need an offline plan; resource
   caps are not an end-to-end restore time guarantee.
4. The existing `SECURITY.md` documents a historical database in Git history.
   Credential/session remediation and coordinated history cleanup still need
   owner verification. This audit did not read/export that database, rotate
   credentials or rewrite history, and does not claim that exposure resolved.
5. Browser bundle headroom is tight, especially on PR #13. Keep the existing
   512 KiB initial-JavaScript budget; avoid adding features to the startup path.
6. Real-device video/posting acceptance and post-deploy worker shutdown/error
   log checks remain necessary. Timer regression coverage is not proof that
   every iPhone upload, codec or large-file path is healthy.
7. News redirect policy retains the existing registrable-domain heuristic.
   Before adding hosted or multi-tenant publishers, replace it with an explicit
   publisher host policy or a maintained public-suffix implementation. Current
   approved publisher hosts were reviewed; TLS/socket behavior was reviewed in
   source and covered with injected transports, not live publisher calls.
