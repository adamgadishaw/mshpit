# iOS direct-message layout and keyboard fix

Implemented on `fix/ios-message-keyboard` in `/tmp/mshpit-message-keyboard`, based on installed-polish source revision `3bc93e0`. No changes were made in the shared navigation checkout. No app was installed, launched on a device, or deployed; no live messages were read, sent, or changed.

## Cause and behavior

The supplied `IMG_2283.png` shows a short outgoing message inflated by a timestamp/footer inside its painted bubble, plus a truncated single-line composer placeholder. The screenshot does not show the keyboard; the keyboard fault was reproduced in a runtime regression using the installed React Native 0.86 calculation.

`ThreadScreen` used `KeyboardAvoidingView` with padding and its default zero offset underneath the app's safe area and optional verification/player chrome. RN compares its parent-relative frame against window keyboard coordinates. For a thread at window Y=90 with height=720 and keyboard top=510, the old calculation reserves 210pt and leaves 90pt of overlap. Measuring the actual window frame reserves 300pt and places the content bottom at 510.

The iOS thread now reuses `IOSPostKeyboardView`, the existing measured keyboard owner already used by post comments. It handles keyboard show/hide/frame changes, existing keyboard metrics, app foregrounding, layout changes and stale measurements. The app shell remains the safe-area owner; the composer has only 8pt of ordinary bottom padding. The scroll view disables automatic keyboard insets to avoid a second adjustment, uses native interactive dismissal and permits handled taps while typing.

The iOS scroll hook follows viewport changes without an additional scroll animation when already near the newest message. It preserves older-history reading, reduced motion and scope isolation, including a retained ScrollView across an account/auth transition that does not emit another initial layout event.

The composer is multiline with explicit Send; Return adds a newline. Its minimum accounts for font scaling, while its maximum responds to the available area below the header and above the keyboard. At 3x text and a 140pt body, one complete line gets an 88pt editor. Longer text scrolls inside the bounded editor. The same input and draft lease survive keyboard changes, and failed sending preserves the draft.

Only message content paints the iOS bubble. Timestamps and delivery controls sit outside it; incoming profile photos and a 44pt report target sit beside the message column. Failure controls wrap. Outgoing body text and underlined mentions use the existing dark-label/`amberStrong` palette pairing, whose contrast is covered across all 12 themes. `MentionText` accepts an optional style override; its default appearance is unchanged. Android and web retain their previous keyboard container, single-line submission, and bubble structure.

## Verification

- 171 focused tests passed, with zero failures/skips: keyboard lifecycle and original overlap reproduction, geometry event ordering, drafts, send admission, stale account/route callbacks, announcements, post-keyboard reuse, and theme contrast.
- Installed Yoga gate passed 320 message-bubble cases and 600 composer cases: widths 320–768, text scale 1–3, text up to 1000 characters, incoming avatars/report controls, failure controls and reduced vertical space. It checks full scaled-line space when the body can accommodate it.
- Syntax gate passed (928 Node files); architecture and `git diff --check` passed.
- Final Expo exports succeeded for iOS, Android and web. The final iOS source map was compared with the exact current ThreadScreen, MentionText, iOS scroll hook and measured keyboard-owner sources.
- Export isolation passed: one Android map and 81 web maps, zero iOS implementation leaks; the existing inert platform defaults were retained.
- Independent source review found no unresolved material source issues after the report spacing, mention contrast, scope-resize and large-text corrections.

The tests render actual React components/hooks and execute the installed RN calculation, with synthetic native events/bounds. Yoga uses synthetic text measurements. These checks do **not** validate native glyph rendering, VoiceOver output, keyboard animation timing, or interactive dismissal tracking/cancellation. Available simulator inventory was checked (iOS 27.2); no simulator app was installed or launched because installation must be coordinated with the parent task.

Before phone rollout, coordinate integration with the navigation/messaging work and check the candidate build with: keyboard open while typing; long multiline draft at the largest text setting; show/hide and interactive drag/cancel; reading older history while new messages arrive; hardware keyboard; draft survival after leaving/returning; and supported orientation changes. The application currently configures portrait orientation and disables tablet support.

## Reproduction commands and evidence

Use `PATH=/Users/adamgadishaw/.local/node24/bin:$PATH TMPDIR=/tmp` on this host. Dependencies were reused from the existing checkout without installation.

```sh
node --test src/lib/useChatScroll.ios.test.mjs src/screens/threadIOSKeyboard.test.mjs src/screens/threadIOSControls.test.mjs src/domain/iosMessageDrafts.test.mjs src/domain/messageDraftOwner.test.mjs src/domain/messageRelationshipContextUi.test.mjs src/screens/threadIOSRefreshAnnouncements.test.mjs src/screens/threadIOSAnnouncements.test.mjs src/screens/postComposerIOS.test.mjs src/theme.accessibility.test.mjs
node scripts/verify-ios-message-layout.mjs
node scripts/check-syntax.mjs
node scripts/check-architecture.mjs
CI=1 EXPO_NO_TELEMETRY=1 node node_modules/expo/bin/cli export --platform all --output-dir /tmp/mshpit-message-keyboard-final-export --source-maps --max-workers 2
node scripts/check-ios-export-isolation.mjs --android-map /tmp/mshpit-message-keyboard-final-export/_expo/static/js/android/index-99b6e12acf423789da49d7f3e0691f1a.hbc.map --web /tmp/mshpit-message-keyboard-final-export
```

Local evidence: `/tmp/mshpit-message-keyboard-final-tests.log`, `/tmp/mshpit-message-keyboard-final-syntax.log`, `/tmp/mshpit-message-keyboard-final-architecture.log`, `/tmp/mshpit-message-keyboard-final-export.log`, and `/tmp/mshpit-message-keyboard-isolation-verified.json`. The earlier `final-isolation.json` is superseded: that invocation mistakenly supplied the nested web directory instead of the export root; the corrected gate passed without changing code.

## Established references checked

- [Required Expo SDK 57 documentation](https://docs.expo.dev/versions/v57.0.0/)
- [Expo keyboard handling](https://docs.expo.dev/guides/keyboard-handling/)
- [Expo SDK 57 safe-area context](https://docs.expo.dev/versions/v57.0.0/sdk/safe-area-context/)
- [RN 0.86 KeyboardAvoidingView and window offset](https://reactnative.dev/docs/0.86/keyboardavoidingview)
- [RN 0.86 Keyboard and synchronized layout animation](https://reactnative.dev/docs/0.86/keyboard)
- [RN 0.86 ScrollView keyboard insets and interactive dismissal](https://reactnative.dev/docs/0.86/scrollview)
- [Apple keyboard-layout-guide guidance](https://developer.apple.com/documentation/uikit/adjusting-your-layout-with-keyboard-layout-guide)

The existing measured core-RN handler was reused without a new native dependency. Expo SDK 57's documented keyboard-controller option remains a separate future migration if native frame-by-frame interaction is required after on-device review; this patch does not claim to provide that migration.
