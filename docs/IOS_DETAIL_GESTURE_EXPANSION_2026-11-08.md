# iOS detail Back coverage, 2026-11-08

## Scope and source audit

Read the repository AGENTS.md and exact Expo SDK 57 reference before editing: https://docs.expo.dev/versions/v57.0.0/. No SDK upgrade, dependencies, backend, Store, Android/web behavior, native build, or device actions.

- Root App.js `back`/`popStack` already pops the actual stack, preserving the previous frame rather than guessing a main tab. The existing route/account/confirmed-reader/presentation fences and deferred composer-close guard remain unchanged.
- `iosNavigationPolicy.mjs` previously excluded Artist (`artistName`), Show (`openLog`) and Post (`post`) completely. Profile and Venue were already allowed. This patch allows all five, plus read-only follow lists, Privacy and Terms.
- ArtistScreen has a screen-local song-report box. Its open/busy state blocks the optional edge gesture. Cancel closes the box but intentionally leaves old input strings; those hidden strings must not keep Back disabled.
- ShowScreen has a screen-local GoingTicketComposer. An open ticket prompt or pending Going update blocks the optional edge. Existing explicit controls are unchanged.
- PostScreen uses Root-owned account/epoch/post comment leases. Text, reply, pending delivery and failed retry survive ordinary Back, so Post is deliberately NOT blocked merely because a comment is typed or pending.
- Festival plans, forms, authentication, editors, moderation, and Gallery remain outside generic edge navigation. Gallery retains its independent gestures.

## Mechanism

`useIOSDetailBackBlock.ios.js` provides a layout-effect registration into the nearest detail wrapper. Each blocker has a unique token. Opening a blocker immediately revokes the current permission and gesture generation before requesting a render; stale native release and deferred Root callbacks cannot revive after closing it. All blockers must close to renew a fresh gesture. Android/web resolve an import-free no-op hook and retain their passthrough detail wrapper.

## Honest motion limit

This patch expands safe coverage; it does NOT claim native-stack-quality interactive motion. Existing IosDetailNavigation translates only the outgoing screen, capped at 42% width, over solid background. Release invokes Root Back and springs the translation home. There is no live previous-detail page reveal. Adding that correctly needs a separate retained/preview overlay design with activity, data fetching, media, accessibility and mutation ownership gating; merely rendering the old screen twice would be unsafe. Main-tab pager work is separate.

## Contextual actions

TicketStub already offers an iOS 500ms body long press and explicit More fallback, backed by the existing native post action sheet and current capability checks. ProfileActionMenu already has an explicit native ActionSheet ellipsis. Artist, Venue and Show expose individual real controls but do not have a generic vetted contextual action model. No arbitrary empty long-press handlers, pressure-only interactions, invented destructive actions, or live mutations are added.

## Validation

- 58 focused tests across IosDetailNavigation.ios.test.mjs, iosShell.test.mjs and iosNavigationPolicy.test.mjs: real React lifecycle, actual extracted Root Back/guards/current-route predicates, exact previous frame identity, stale queued native callbacks, two simultaneous blockers, Suspense/reader interruption, actual Artist/Show blocker expressions, actual Artist Cancel callback, Post lease preservation, Worklets transform and Metro platform resolution.
- 114 additional existing tests: artist presentation/return, show refresh recovery, comment announcements/drafts, Feed return retention and post action bridge.
- `git diff --check` clean.
- No full build/device claim. Device acceptance still needed for edge drag feel, nested scroll arbitration and optional editor-state affordances.
