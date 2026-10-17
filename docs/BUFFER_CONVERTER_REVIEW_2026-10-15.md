# Buffering and converter retry review — October 15

This follows the pushed app branch at b5a7ffa. Public media access was read-only and unauthenticated; converter checks used synthetic local inputs without real uploads or account mutations. The website checkout and production services were not changed.

## Buffering isolation

The existing public 25.175-second clip contains 22,564,474 bytes. Its source URL hash is 44439d27b68cb5db38c57eab5260cb232148d2c95354534d9245209c26f5ea7c. At 19:27 UTC its public R2 endpoint returned HEAD 200 in 324 ms and valid 206 responses for bytes 0–1048575 and 1048576–2097151 in 326 ms and 260 ms. Each range body contained exactly 1 MiB, with correct Content-Range and Accept-Ranges:bytes. These bounded host reads do not establish sustained Android network throughput or CDN performance for all clients.

Native telemetry deliberately bypassed accessibility control discovery. Normal-audio remote playback advanced 0.939 seconds over 7.273 device seconds, alternating loading/ready even as the buffer reached the full 25.175 seconds. Replacing only the source with the already cached app-private copy still advanced just 1.664 seconds over 8.288 device seconds, fully buffered throughout the measured interval. With the local source and audio disabled diagnostically, playback advanced 8.219 seconds over 7.948 device seconds with no new loading event during the interval. Timing includes asynchronous native sampling and must not be interpreted as frame-presentation latency.

Android AudioTrack logs at 15:27:34,15:27:38,15:28:01,15:28:04,15:28:07 and 15:28:11 local emulator time report device-stall timestamp correction during the normal-audio probes. This comparison supports an emulator/audio-path limitation rather than demonstrating an app-side buffering or media range defect. It does not prove audibility, certify a physical phone, or justify disabling user audio. No player configuration/source fix was made. The diagnostic player was closed and released; subsequent ordinary playback constructs a fresh native player with default audio behavior.

Raw receipts: task buffer-network-probe.json and app ignored .tmp/overnight/player/buffer-review-remote.json, buffer-review-local.json, buffer-review-local-silent.json. The existing clip was not uploaded or converted for this comparison. Missing accessibility targets remain a separate automation limitation.

## Reproduced converter defect and correction

A deferred retry for clip A could finish after the notice received replacement clip B, update the replacement state, and invoke its latest onReady callback. The synthetic replacement regression failed before the fix. A retry could also be dispatched twice from the same rendered callback before React committed the disabled state.

Retry ownership now changes in a layout effect at commit and cleanup, so retired completion cannot publish after replacement or unmount, including the window before passive effects run. A synchronous in-flight ref serializes repeat presses. A rejected retry keeps the failed clip visible and permits a later retry. Poll cadence, API contracts and server conversion behavior are unchanged; no pending server work is claimed canceled.

The fixture separates layout and passive effect cleanup/setup. An in-memory negative variant using passive ownership invalidation fails the deferred-passive replacement assertion; the actual implementation passes. Tests cover replacement, unmount, same-turn repeat, rejection then successful retry, foreground polling, serialized checks, late poll cancellation and existing web interval-first behavior. No real API request is involved.

## Validation and limits

Focused converter/player recovery tests passed 19/19 before the final test-harness refinement; final converter tests pass 7/7. Syntax and architecture checks pass. Final full suite: 6,449 passed, zero failed, one skipped (6,450 total), 88.4 seconds. Android Hermes export passed: 2,207 modules, 9.5 MB, 40.7 seconds. CI status is recorded in the PR/handoff after push. Independent review examined the promise/effect ordering and the corrected negative test.

Owner final runtime at 19:32:46 UTC: Feed, signed-in/auth-ready, native auth flow idle, active/stored Ember unchanged; Post/Like/Report blocked and feed revalidation allowed. No paid service, enrollment, signing change, production upload or deployment.


