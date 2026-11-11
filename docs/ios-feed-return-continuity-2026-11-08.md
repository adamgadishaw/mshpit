# iOS Feed return continuity

## Scope

The prior actual React/Root fixture reproduced 24 revealed Local rows becoming 8 after Post, Profile, or Show and Back. The selected filter already persisted correctly. Direct photo viewing already kept the same list instance. This patch retains those existing navigation/mount boundaries and filter ownership.

An iOS-only Root owner stores one bounded UI snapshot for the current account, authentication epoch, and Feed base-frame lifetime. The snapshot contains the selected scope, revealed count (up to 64), ordered opaque row keys (at most 65 including discovery), an anchor key, within-cell offset, width, and font scale. It contains no post/result objects, service/cache state, disk persistence, URLs, or telemetry. New tab entry, replacement base frame, account change, and epoch change revoke the old lease.

## Restoration and cancellation

For You and Local reuse only currently cached rows. Existing FlatList initial rendering, batch sizes, window size, viewability/media/impression handlers, and direct-gallery retention are unchanged. Following and News retain their existing local loaders and receive no automatic restore or pagination.

The stable iOS cell wrapper forwards React Native's cell style, focus handler, layout handler, and children. The original native layout handler runs first. Return validates current row order and geometry, then uses current native measurements for a coarse seek if the target is unmeasured. Further attempts require fresh measured-index progress. The target's own current measured layout completes the exact anchor offset. There are at most six attempts and a single 1.5-second deadline, with no retry polling or fabricated getItemLayout.

A real drag, filter change, explicit refresh, changed row order, changed geometry, lost presentation, or lifecycle teardown invalidates captured callbacks. Root's presentation predicate rejects callbacks immediately after navigation changes, before the Feed unmount commits. StrictMode/Suspense effect reactivation installs a new callback revision. An invalidated width/font-scale anchor cannot be relabeled for a later return.

If the anchor cannot be measured within the bounds, seeking stops at the current viewport without an automatic jump to the top. The revealed count remains available. Provisional coarse offsets are never saved as successful return positions. More than 64 revealed posts intentionally falls outside the saved snapshot bound.

## Verification and limits

The hermetic fixture uses installed React and React reconciler, actual Feed, actual NativeFeedMediaLayer, the exact Root retention conditional, and extracted actual Root owner/presentation statements. Its native-list model starts with three cells, progresses in two-cell batches, models unmeasured-tail clamping and the existing viewport window, and checks both uniform and changed heterogeneous heights. It does not replace native-device testing.

Focused cases cover Post/Profile/Show return, For You/Local, same-instance gallery return, account A/B/A and same-ID epochs, fresh base/tab entry, missing/reordered anchor, width/font-scale double-return, drag/filter/refresh cancellation, stale layout/scroll callbacks, precommit navigation, StrictMode/Suspense, capped attempts, captured deadline expiry, inert Android/web defaults, and Following/News exclusion. No production API, native UI, dependency, signing, permission, or deployment changes were used.

Physical scrolling, media decode timing, touch feel, and exact viewport settling remain uncertified while the Mac is locked. The modeled clamp progression proves bounded behavior and current-layout anchoring, not guaranteed deep restoration on every device or content distribution. Root integration owns final platform exports and signed-artifact validation.

References read before implementation: Expo SDK 57 reference (https://docs.expo.dev/versions/v57.0.0/), React Native 0.86 VirtualizedList documentation (https://reactnative.dev/docs/0.86/virtualizedlist#onscrolltoindexfailed), and installed React Native 0.86.3 VirtualizedList/CellRenderer source.

Recorded local gates: `npm test` passed 8,266/8,266 tests with Node 24 and the repository's throwaway-SQLite runner; the focused Feed return file passed 30/30. `npm run check:syntax` passed 920 Node files. `npm run check:architecture` and `git diff --check` passed. Existing Feed image-retry/head-status fixtures were adjusted only to traverse the new transparent provider. Platform exports and native build/device validation were not run in this isolated worktree.
