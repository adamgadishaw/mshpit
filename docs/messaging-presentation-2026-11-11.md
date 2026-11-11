# Messaging presentation handoff

Base: installed app source `85fbc1daeccd2913ae3d36af44115915131801f4`.
Branch: `feat/messaging-presentation-20261111`.
Worktree: `/tmp/mshpit-messaging-presentation-20261111`.

The source was verified clean before creating this separate worktree. Its only repository instruction was `AGENTS.md`; the exact Expo 57 reference was read before coding. No `.agents/skills` files were present in the supplied source snapshot. The obsolete `bbae706` worktree was not used. Calendar, backend, authentication, consent, delivery and history fixes from the installed source remain intact.

## User-visible changes

- The Inbox has a compact messaging header with a 44-point compose action. The oversized separate orange compose pill is gone.
- Conversation search filters the current folder by participant name, bare or `@` handle, and latest message preview. It normalizes accents and matches all entered words. It makes no full-history search claim and does not fetch people while filtering conversations.
- Calm conversation rows replace the bordered cards. Photos/initials, name, latest preview, time and unread count have distinct hierarchy. The count caps visually at `99+`; accessibility retains the true count.
- Messages and Requests are lighter tabs with a visible request count. Request guidance reflects the existing explicit acceptance flow. Empty, no-match, loading, error/retry and new-message states have specific usable actions.
- Compose opens a dedicated people-search view, preserving the existing debounced search, cancellation, retry and self-filtering. Local search remains separate. Account/epoch changes clear search state, and stale conversation/person callbacks cannot navigate a replacement account.
- Conversation headers share the messaging hierarchy and show the person's handle when available. Repeated accepted-friend badges/cards are removed. Useful request/shared-show/concert-buddy context remains as compact text.
- Large text reflows the header's navigation/title into separate rows, places request counts within their tab, and stacks a conversation's name/time. Text scaling is not disabled or capped.

The sole native keyboard owner, measured body viewport, stable multiline composer, adjacent incoming avatars, compact bubbles, delivery controls, report controls, privacy disclosure, explicit Accept, refresh behavior and history anchoring remain unchanged. The shared non-messaging `ScreenHeader` was not edited.

## Evidence and verification

The user's installed-app screenshot (`IMG_2294.png`, Library identity `libfile_7dbac6ab32f48191a052810c72be243a`) was materialized in this chat's workspace and its pixels inspected before coding. It is not included in the deliverable archive because it contains actual account/message details.

Synthetic UI evidence: `/tmp/mshpit-messaging-presentation-evidence`.

`render-messaging-presentation.mjs` executes the actual production components through React Native Web with iOS branches, synthetic member/message data, a simulated safe area and text scale. `capture-messaging-presentation.mjs` captures them in an isolated, network-blocked headless Chrome session with exact mobile viewport overrides. These are rendered components, not a manually drawn mockup. Native keyboard/refresh boundaries are replaced by inert layout boundaries for screenshots; behavioral tests exercise their production integration separately.

Twelve screenshot scenarios cover before/after sparse inbox, populated inbox, 320-point/2× large text, Requests, search results, no-match search, empty Messages, compose, and before/after conversation (including large text). The checks assert exact viewport width, no horizontal overflow, every action's horizontal bounds and at least 44-point touch height (with a one-pixel rounding allowance), and a single-line large-text Messages title without an orphan letter. Measurements and renderer details are saved in `measurements.json` and `manifest.json`.

- **207 focused tests pass** across inbox behavior/helpers, iOS thread keyboard/control/refresh behavior, history, privacy controls and inbox/thread load recovery.
- Syntax gate passes: **946 Node files**. Architecture gate passes with unchanged legacy ceilings.
- All **12 rendered scenarios** pass the viewport/control-bound checks. The initial large-text orphan-letter and request-count crowding were corrected and recaptured.
- Independent source review found no remaining production regression.
- One earlier parallel test run hit a timing-sensitive assertion in the unchanged privacy-control test fixture (its async result had not rendered yet). The complete final focused suite was run serially and passed all 207 tests; no privacy implementation or test assertions were relaxed.

Commands (Node is `/Users/adamgadishaw/.local/node24/bin/node` on this Mac):

```sh
node --test --test-concurrency=1 src/screens/inboxPresentation.test.mjs src/domain/inboxPresentation.test.mjs src/screens/threadIOSControls.test.mjs src/screens/threadIOSKeyboard.test.mjs src/screens/threadIOSRefreshAnnouncements.test.mjs src/domain/directMessageHistory*.test.mjs src/domain/iosInboxLoad.test.mjs src/domain/iosThreadLoad.test.mjs src/components/MessagePrivacyControls.test.mjs src/domain/messageRelationshipContextUi.test.mjs
node scripts/check-syntax.mjs
node scripts/check-architecture.mjs
node scripts/render-messaging-presentation.mjs
node scripts/capture-messaging-presentation.mjs
```

The two rendering scripts use the existing React/React Native Web/Babel dependencies and installed Chrome; no package or lockfile changes. The capture script accepts `PIT_CHROME_BINARY` and both scripts accept `PIT_MESSAGING_EVIDENCE`.

## Integration boundary

This is ready for the parent task's combined integration checks. No native build, phone install, production deploy, push, account changes, real message sends, or full 9,690-test rerun occurred in this phase. Native glyph metrics, Dynamic Type, VoiceOver, safe-area behavior and keyboard animation still require verification on the combined native build. Browser render checks do not certify those.

No group-chat UI, online status, typing indicators, read receipts, attachment/call buttons or encryption guarantees were invented. Existing privacy controls still explain that DMs are server-readable and not end-to-end encrypted.
