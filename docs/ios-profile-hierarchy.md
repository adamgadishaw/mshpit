# iOS profile hierarchy

## Scope

The iOS profile uses a single cover/avatar composition, with Manage profile beside the avatar, direct badged Inbox and Activity shortcuts, and social/history counts before its content controls. Posts is the default section. Shows retains favorite shows, upcoming events, concert history/map, rewards, and the owner's private concert memories. Gallery retains the existing full-size image/video payloads, retry and pagination behavior.

The sections remain mounted to preserve media and map state, while inactive sections have no layout or accessibility-tree presence. The existing guest/public/private guards and unknown-total/error states are unchanged. Android and web resolve inert presentation helpers and retain their previous section order, controls and base styles.

Static banner/gallery exclusions were removed so these areas can participate in page gestures. True horizontal memory rails and the concert map keep their existing gesture exclusions.

## Pager integration

Depends on the pager's platform-resolved useNativeTabPreview and useNativeTabContentReady hooks, with false/no-op defaults on Android/web. Preview blocks the rewards request (which can write earned achievements) and profile refresh. Readiness depends on the primary identity/post history or an honest terminal error/missing state, never optional maps/rewards. Signed-out You reports its existing login screen as ready.

The new owner shortcut callbacks have layout-owned presentation tokens. Unmount, Suspense hide/reconnect, account changes and preview/promotion retire old handlers. Captured preview callbacks cannot gain permission after a later promotion.

## Verification

70 focused tests passed:

`node --test src/screens/profileIOSPresentation.test.mjs src/screens/profileHistoryIOS.test.mjs src/screens/profileMediaIOSIntegration.test.mjs src/screens/profileConcertTruthfulnessIOS.test.mjs`

The integration tests use the pager's actual preview/readiness hook implementations and contexts (verified against f1cfb2c), actual React, profile/history/media behavior and mocked native hosts/transport. Coverage includes section state and accessibility visibility; retained image hosts; account/auth resets; preview rewards/refresh gating; primary readiness; badge actions and stale callback retirement; both nested layout-callback orders for concert deep links; canceled and repeated deep-link entry; gallery pagination/retry/private revocation; large text; and Android/web presentation isolation.

Independent review requested the shortcut presentation-lifetime and preview fence, both now implemented and covered by regressions. Transparent native identity containers use box-none hit testing so the cover-photo control stays tappable through the overlap.

No native phone/simulator actions, publication, deployment, or Android code changes were performed for this patch. Focused tests do not certify native pixels, VoiceOver traversal or gesture geometry. Combined web-budget/full-suite/platform-export checks belong to integration.

## Native acceptance after integration

- Check the actual cover/avatar overlap and Manage control at normal and largest text sizes; open the original banner and return.
- Confirm counts precede content; Posts is immediately reachable; Shows/Gallery retain selected map/media state when switching.
- Check VoiceOver only traverses the selected section, and announces section selection and the distinct unread counts.
- Exercise page drags from the static banner and gallery while taps still open their expected media; confirm memory rail/map keep ownership of their own gestures.
- Open concert-history deep links, change section during loading, navigate back, and re-enter the same deep link.
- Verify Inbox/Activity never opens from a canceled preview or retired native callback.
