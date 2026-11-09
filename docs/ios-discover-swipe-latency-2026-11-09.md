# iOS Discover swipe latency correction

Base: `ce319fb` (installed runtime checkpoint `a7a8117`).
Scope: iOS local Feed/Discover pager mechanics; the user identified Discover as the major lag and Feed as minor. No bottom-navigation swipe, backend, dependency, Store, Android/web behavior, or phone changes.

## Reproduced controls, not device performance measurements

- Accepted swipe release waited for the destination's network content readiness, up to 2,500 ms, despite its actual loading screen already being laid out.
- An unchanged outgoing Shows tree rerendered for candidate preparation, layout readiness, and Festival GET completion (2 initial executions grew to 5). It now stays at 2 through those transitions; real parent data updates still rerender it.
- A successful selection whose parent promotion was delayed 30 ms received a premature return-to-source spring from a 0 ms recovery timer.
- Regrabbing a returning page discarded its residual position. A synthetic -60 px return frame followed by a -20 px finger move now yields -80 px, without an old spring callback removing the candidate.
- Reversal A→B→A could use A's old layout credit after A unmounted if the readiness clear had not reached the UI. Each direction now gets a fresh admission token.

## Corrections

- Settlement waits only for actual module-resolved native screen layout, never network completion. Real loading, empty, and error content can settle normally.
- The Festival lazy boundary moved from its inner iOS panel to the existing page boundary, so its lazy spinner cannot impersonate actual incoming screen readiness. Explicit active selection still receives the same loading indicator.
- Memoized page plus stable Discover render adapter skips outgoing renders caused only by candidate/readiness state.
- Local callbacks explicitly report accepted/declined selection. Accepted navigation retains the settled destination through React promotion; declined selection recovers and rearms.
- Regrab cancels the old animation only after horizontal intent wins and includes the residual position. Layout carry is allowed only while a matching unfinished return owns the still-mounted candidate. Completed cancellation and reversal cannot lend obsolete readiness.
- Late JS owner/gesture admission checks remain. No per-frame RN dispatch or broad shared-value redesign was introduced.

## Verification

- 168/168 related tests pass: actual React swipe component suite, legacy native rail, Discover presentation, page geometry/release, programme/lazy-loading, social controls, language, and navigation contracts.
- The swipe suite includes the actual production Discover `renderPanel` callback, not just a direct nonlazy Festival substitute, and tests suspended module vs real resource-loading UI.
- Regressions retain cancellation, reversal, nested native gesture priority, current-route/account/StrictMode fences, Reduce Motion/VoiceOver, same resource instance across promotion, preview read ownership, and no hidden impressions/dwell/persistence/refresh registration.
- Installed Expo SDK57 Babel preset compiles all 7 changed runtime JSX files, including real worklet transformation. Node syntax gate passes 926 files. `git diff --check` passes.
- Shared Discover source before and after its iOS-only return branch is byte-identical to base. Android/web exports and full aggregate gates remain for integration.

## Remaining gates and limits

No phone use, recording, install, export, signed build, full aggregate test run, or push was performed for this candidate. Initial cold module/native layout still has to exist before finger motion can safely uncover the real incoming screen. There is no speculative neighbor mounting, module preload, or idle resource GET. Tests use synthetic native recognizers, scheduler, and animation frames and do not establish native frame rate or user-perceived smoothness. The parent must complete integrated gates and the signed build, then obtain user validation on Discover when the phone is free. The existing installed app remains untouched.
