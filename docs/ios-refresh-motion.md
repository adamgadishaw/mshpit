# iOS refresh visibility and settle

The native refresh boundary now keeps a fast pull-to-refresh visible for one second after its animation commits. The existing pop lasts 370ms and the record rotates once every 900ms. Requests still start immediately on release and publish their results immediately; only the native indicator/inset waits for the remaining visual interval. Requests longer than the interval settle immediately upon completion. UIKit continues to own the gesture, threshold, scrolling, inset, and return animation. The record keeps its current pose during that return instead of snapping to its initial rotation.

The vinyl sits below the activity bar's measured height, including Feed tabs and wrapped large-text rows. Previously the overlay sat behind that bar. Its position and opacity still follow the real overscroll gap; ordinary or canceled pulls do not start a timer or a request, and scrolling away does not pin an overlay over content.

Reduce Motion disables the spin/pop and decorative delay, including a preference change during an active hold. Repeated releases coalesce. Account/route chrome ownership, detail command ownership, disabling, backgrounding, and unmounting retire obsolete visual work; late results cannot clear a subsequent refresh. Existing request controllers continue to own transport cancellation and data freshness. Callback changes caused by fresh rows or bar remeasurement do not reset the visible interval.

Only `src/components/VinylRefreshBoundary.ios.jsx` changes runtime behavior. Android/web refresh, native dependencies, the feed tabs, title layout, and earlier session/upload/profile/badge/notification changes are preserved.

## Verification

- Read the exact Expo SDK 57 reference before changes.
- Focused boundary, real Feed, retained detail, Artist, and Show lifecycle tests: 174/174 passed.
- Scroll chrome, retained Feed, scoped refresh, and existing Android/web refresh regression tests: 70/70 passed.
- Fake-clock tests cover fast and slow responses, immediate result visibility, deferred JS commits, short canceled pulls, repeat gestures, failures/retries, live Reduce Motion, background/disable interruptions, account/route retirement, and ignored transport cancellation.
- Artifact/export evidence is kept in `.tmp/native-refresh-motion/evidence`; the source is frozen before bundling.

Native gesture speed and the actual device appearance still require physical acceptance. React/native fixtures validate state, timing, geometry, and unchanged scroll ownership; they cannot prove UIKit animation feel. No phone or simulator interaction was performed. Any signed QA repack reuses the existing verified native runtime and is not a fresh native compile.
