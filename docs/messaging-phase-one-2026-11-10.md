# Messaging phase one — reliability, history and control

This is a local implementation handoff, not a deployment or a claim that every item in the research roadmap is complete. It follows Adam's instruction to implement the reviewed improvements while preserving the new design and the parallel keyboard/swipe work.

## PC recovery checkpoint — 2026-11-11

The downloaded `mshpit-recovery-2026-11-10.zip` was rechecked at 17,340,156 bytes and SHA256 `108d1821989c2a1c0705251ce0e4562f5924a6090491e21c694b20b0e305c12d`. All 29 ZIP paths were checked before extraction. The inspected recovery scripts were reproduced with Node because the installed Python launcher was unavailable: all 23 archive-manifest entries, four current-source-index entries, refs, 172 available commits, and standalone `git fsck --full --strict --no-reflogs` passed. The preserved shallow repository was not modified.

The exact messaging snapshot is `C:\Users\Adam Gadishaw\Documents\Codex\2026-11-10\task-3\messaging-exact`. All 2,845 files (45,419,802 bytes) match the full source manifest, including this originally untracked report. HEAD is `bbae7065ba7bfd28d8fab51392927ce2e2c263f9`, branch `feat/messaging-phase-one`, and porcelain status contains only `?? docs/messaging-phase-one-2026-11-10.md` after excluding the deliberately omitted Mac dependency link. Line-ending conversion is disabled. That exact snapshot remains unchanged.

Edits and fresh tests use the separate `task-3\messaging-integration` checkout, branch `fix/messaging-consent-recovery`, based on the recovered messaging HEAD. Its name describes its role; it is not yet the final combined PC/calendar candidate. The PC baseline `266a25de7a9bcf1a0deef4afa263af36db38ec02` is retained separately. Main integration owns combining that baseline with shared Mac prerequisites `b56c58089f5e25e232e10e8ba2ae15458df13a8b..3bc93e0f3e458d2bea67b2be9c77f363f8b19d3d`, calendar changes, and this messaging series. Do not apply only the keyboard patch onto the older PC tree: its earlier native dependencies are absent there.

### Completed recovery fixes

- Request acceptance is captured before message removals and cache trimming, so replacing the last accepted row cannot move a conversation back to Requests.
- Confirmed Accept invalidates inbox hydration/refresh, live-thread and older-history reads that began earlier. Queued React message, profile, read-marker and acceptance updates recheck their read/account ownership before committing.
- A superseded access-denial response cannot hide a newer authorized conversation. A queued denial cannot erase a cache owned by a newer request.
- DM, fan-club and lounge acknowledgements recheck account/authentication epoch inside queued state updaters, preventing old plaintext from returning after an account reset.
- Duplicate/tombstoned history pages advance without waiting for a nonexistent prepend layout. Web anchors select surviving rows, suppress following for one content change, and retire unresolved anchors before subsequent content changes.

The first ten consent regression cases failed on the recovered source, then passed after the fixes. Three queued-acknowledgement cases also failed before the account fences. The history regressions cover no-op pages, deleted anchors, late layout callbacks and unchanged geometry.

### Fresh checks and integration boundary

The final focused run passed 127 tests across actual Store commands, client/server consent, removal history, delivery, controls, keyboard behavior and scrolling. Syntax passed for 932 Node files; architecture and `git diff --check` passed. The original C++ compiler command is Unix-specific; an external MSVC adapter ran the unchanged production style extraction, Yoga sources, C++ fixture and all 920 geometry assertions successfully. No project compiler configuration was changed.

Fresh iOS, Android and web exports are stored under `task-3\deliverables\messaging-final-export`. Their source-map verification and broad-suite/budget results are recorded in the accompanying delivery evidence. Earlier exports and the Mac's historical passes are not substituted for this source check. Any combined calendar/PC candidate still requires its own final gate and fresh native input checks.

Source maps match 796 iOS, 747 Android and 756 web project code modules exactly. The Android/web iOS-isolation verifier passes. Its `--report` path check uses a POSIX separator and rejects valid Windows sibling report paths; the successful verification was captured from its JSON stdout without changing or weakening the checker.

The broad `node scripts/run-tests.mjs --test-concurrency=2` run completed with 9,142 passed, 9 failed and 1 skipped (9,152 total). Final affected tests were separately rerun after the last review changes. The nine failures are triaged, not claimed passed:

- Two symlink-fixture tests cannot create symlinks under the Windows account (`EPERM`).
- One export-isolation CLI test cannot write its report because of the Windows/POSIX separator bug above.
- Five Worklets transform tests in `IosDetailNavigation.ios.test.mjs`, `NativePhotoSwipe.ios.test.mjs`, and `NativeSwipeRail.ios.test.mjs` pass URL `.pathname` strings as filenames, producing paths such as `C:\C:\Users\Adam%20Gadishaw\...`; they need `fileURLToPath` in the shared native test harness.
- The startup-bundle assertion exceeds the unchanged 512 KiB gzip limit. The canonical final `npm run build:web` produces 515.8 KiB; a fresh unchanged `bbae7065` baseline export also fails at 515.7 KiB. The cap was not raised.

All eight Windows tooling failures were reproduced independently on the unchanged recovered baseline in `task-3\messaging-baseline-check`. They and the existing startup-budget overage remain shared integration gates; no unrelated navigation/tooling source was changed in this messaging patch. The old untriaged SEO/tour-date failures did not recur in this broad run. Dependency audit, native compilation/signing, physical-device behavior and final combined-candidate testing were not run in this track.

The original PC checkout, dirty D: checkout, Mac, phone, accounts and production were not modified. No native compilation, signing, cloud build submission, push, deployment or installation occurred. The iPhone preparation handoff at `task-2\mshpit-ios\docs\IPHONE_BUILD_HANDOFF_2026-11-11.md` was read; final native autolinking/prebuild/pod checks must include the recovered shared iOS prerequisites and retain scene-lifecycle wiring. Release previews use production; development read-only flags are not a sandbox for them.

## Integration

Worktree: `/tmp/mshpit-messaging-phase-one`, branch `feat/messaging-phase-one`.

The branch starts from `407aa2f` (`fix/ios-message-keyboard`). That prerequisite supplies the measured iOS keyboard container, compact content-sized bubbles, incoming profile photos, bounded multiline composer and large-text layout. This branch preserves those changes. The separate navigation/swipe and You-page duplicate-header work is outside this branch.

Implementation commits after that prerequisite, in order:

- `641ce2f` — scoped privacy disclosure and controls.
- `fbc775e` — direct-message delivery presentation, request acceptance UI and scoped feedback.
- `ed44804` — reliable send admission, truthful failures and canonical acknowledgements.
- `2987e90` — durable directional request acceptance and privacy lifecycle.
- `41590da` — matching fan-club/lounge delivery feedback.
- `bbae706` — earlier-history recovery, complete conversation removals and integrated consent metadata.

If the keyboard commit has already been applied, integrate only the commits after it. No dependency packages were installed or changed. Testing reused the existing checkout's `node_modules` via an untracked local symlink.

## Behavior delivered

### Delivery and recovery

- A lost acknowledgement now reads **Not confirmed**, because the message may already have reached the server. Explicit Retry reuses the same mutation ID. A new composer Send is still a new user intent; text is not silently deduplicated.
- Definite rejection and authentication failures have distinct explanations. Permanent failures do not expose a Retry action. A prior uncertain attempt remains uncertain even if a later attempt receives a rejection or authentication failure.
- Dismissing an uncertain item explicitly removes only that local pending entry; it does not claim to retract delivered content.
- The shared 100-item outbox rejects new admission when full instead of silently discarding an earlier pending message. Direct-message, fan-club and lounge composers explain capacity failure and retain the draft.
- Send acknowledgements include the canonical creation timestamp. Authentication/epoch checks protect dispatch, retry, cancellation and late completion.
- The outbox remains memory-only. This phase does not claim survival after app termination. A rate-limited Retry remains visible, with a wait explanation; the Store prevents premature dispatch.

### Older direct-message history

- Load earlier, loading, retry and beginning-of-conversation states expose the server's existing cursor pagination.
- Pages explicitly loaded by the mounted conversation survive the Store's 750-row recent-cache limit. A separate history lane prevents old pages from cancelling current live reads or replacing the live cursor.
- History is scoped to account, authentication epoch and conversation. Replaced owners reject late responses. Blocking or a current access-denied response hides retained history and clears the appropriate recent cache.
- Native visible-position anchoring and a measured web row anchor preserve position on prepend without changing keyboard avoidance.
- Single-conversation reads return the complete authorized conversation removal list. This fixes old loaded messages surviving when more than 750 newer removals existed. The global inbox removal list remains bounded.
- Read-marker semantics are unchanged; no Seen or viewport-read guarantee was added.

### Privacy and consent

- Privacy and controls starts collapsed inside the conversation history. It explains account mute, block and unblocking in plain language.
- Mute remains an account-wide social control; it does not promise to silence or prevent direct messages. Block requires an inline confirmation, stops DMs and removes mutual follow relationships. The copy explicitly says blocking does not erase existing messages.
- Controls prevent repeated same-tick commands and reject stale account, epoch, conversation, route and presentation callbacks. Success is shown only for confirmed command results.
- Directional request acceptance lives in a new `dm_acceptances` table. The additive migration backfills only existing sent-message/follow evidence; inbound messages alone do not establish acceptance. Database triggers preserve send/follow evidence atomically, including writes by older application processes.
- Inbox and conversation reads expose authoritative request state. Explicit Accept does not send a reply, mark content read, create a follow or relax age/contact/block checks. Queued or failed outgoing messages do not count as acceptance.
- Acceptance metadata is scoped to the viewing account, remains stable across history trimming and cannot regress because an older pending response arrives late. Account export includes only the user's own acceptance choices; foreign-key cascades remove the state on account deletion.

## Encryption boundary and next phases

Messages are currently stored on the server in readable form. The UI says this directly and does not claim end-to-end encryption. This implementation adds no custom cryptography, no new plaintext disk cache and no new logging of message bodies. Transport encryption, encryption at rest and end-to-end encryption are separate properties; this branch does not verify deployment TLS or infrastructure-at-rest settings.

The next security design must explicitly cover a malicious or compromised service, a stolen device, a blocked/former participant, account takeover, metadata exposure and recovery failures. Select a maintained implementation of an established protocol with an independent audit; neither the Signal protocol family nor MLS by itself supplies a complete product. Validate protocol implementation, supported platforms and operational maintenance before selecting one.

Before an E2EE claim, implement and verify device identity, key verification, group membership/key-epoch changes, offline delivery, device removal, attachment encryption, local search, backup/recovery, key-loss behavior and user-directed abuse reporting. Backup/recovery must not silently give the service message keys. Reports must make the user's deliberate disclosure of selected plaintext and context clear. Server-side search, moderation, previews and notifications need an explicit compatible design.

Group chats are not enabled in this slice. Durable directional consent is a reusable permission concept, not a substitute for a group membership model. The next group slice should add explicit invitations and acceptance, member/admin roles, leave/remove behavior, history visibility boundaries and idempotent membership changes before exposing group creation. It must preserve existing pair-keyed DMs and their identifiers during migration.

Protected durable outbox storage, a paginated deletion/change stream, virtualization of long loaded histories, per-conversation notification controls and native device verification remain subsequent work. Loaded history and complete per-thread removal payloads can currently grow with use; measure production-scale migration and history costs before rollout.

## Verification

The PC recovery checkpoint above supersedes this unfinished Mac verification draft. All server tests use throwaway SQLite data through `scripts/run-tests.mjs`; no production data, accounts or sessions were changed.

The Mac phase corrected stale acceptance callbacks, uncertainty-after-auth dismissal wording, missing community-chat queue feedback and saturated removal lists. Its final consent-race patch did not reach disk. The PC follow-up now supplies and tests that fix, along with the additional queued-state and history-anchor findings described above.

Native typing, glyph rendering, VoiceOver output, keyboard animation and interactive dismissal still require device confirmation. Automated layout measurements use synthetic text and native Yoga; successful Expo exports are bundle validation, not installed-app testing.

Research: [mshpit messaging review and 120-item roadmap](https://chatgpt.com/space/page_1ce67a6e7a08819191eb55439862561b). The exact Expo 57 documentation was read before implementation as required by `AGENTS.md`.
