# Combined PC reliability candidate — 2026-11-10

Branch: `fix/pc-integrated-reliability-20261110`.

Preserved inputs:

- Common base `ac6a8374165e27c527c3f3cb23e8ea85bb2dc49e`, containing the five
  feature changes and completed 2,505-post large-history validation.
- Privacy/reliability `7afa14e81ac97ce02192a86d43a5ea6c2549288c`, preserved on
  `fix/pc-privacy-reliability-20261110` and in its independent patch/bundle.
- Original iOS `9857d67c429e70526f91200d83df5b7cd6ccd20a`, imported from the
  verified local bundle into `review/ios-source-reliability-20261110`. Bundle
  SHA256 `2e1081a3df2daa7774b27daf99774e8a3d1a04dcba4f4bdca89c3f58d310e4ff`.
  Its separate task-2 source, history and delivery files are unchanged.

The iOS changes were applied without committing first so the combined source
could be checked. Runtime/test files applied cleanly. The only conflict was two
new STATUS sections at the same insertion point; both were retained and a
combined status added. No runtime hunk required an invented resolution.

The incoming patch fixes native Find a Show export resolution, city prompt
dismissal scope across countries, and disabled native refresh controls/title
capabilities. It does not modify App, Store, backend or dependencies. Independent
Astra review found its callback, request-latch and page-cleanup behavior
compatible with feed recovery and the standalone post badge hook.

The privacy audit and iOS audit retain their separate-source evidence. Their
earlier statements about separate integration are superseded by this combined
candidate; their native/device and missing Mac limitations remain.

## Combined validation

- Complete `npm run check` passed on the integrated runtime/test source:
  **7,191 passed, zero failed, one skipped (7,192 total)**, zero production
  dependency vulnerabilities, syntax (928 Node files), architecture (Store
  hooks 144/144) and web production export. Initial JavaScript is 510.1 / 512
  KiB gzip. Log: task-workspace `combined-quality-gate.log`.
- Independent Astra integration review found no blockers and passed **61/61**
  combined focus checks: native city bootstrap, CityScreen, native refresh,
  page-return/scoped refresh, feed recovery/pagination, guest media actions and
  standalone post badges. Log: `combined-independent-review.log`.

- Combined iOS Metro/Hermes export passed: 2,228 modules; 8,077,524-byte
  bytecode, SHA256
  `4d130fce4dc3824d06e74fa6b9e9d562aa9c7ebf5274f087130be2df143ba499`.
  Source-map verification matched all **698 bundled project modules**, including
  **25 native variants**, against the integrated checkout. Store, PostScreen
  and the new `usePostAuthorBadges` module are present and source-matched.
  The map is 15,179,886 bytes, SHA256
  `50ea836059c119daa805ffd6a05e8dec2d2c64aa07bd5ab82515953f7cb0472d`.
  Logs: `combined-ios-export.log`, `combined-ios-verification.log`; retained
  export: `evidence/combined-ios`; full module/hash report:
  `evidence/combined-ios-source-verification.json` (all task-workspace paths).
- Final `git diff --check` passed. No runtime/test source changed after the
  passing combined gates; only validation documentation was completed.

Commands:

```text
npm run check
node node_modules/expo/bin/cli export --platform ios --source-maps --dump-assetmap --max-workers 2 --output-dir ../evidence/combined-ios
node scripts/check-ios-export.mjs ../evidence/combined-ios ../evidence/combined-ios-source-verification.json
git diff --check
```

The iOS process sets `EXPO_NO_TELEMETRY=1`, `EXPO_OFFLINE=1`, and
`EXPO_PUBLIC_API_URL=http://127.0.0.1:3999`.
No production release artifact, device installation or external API call is
part of the iOS export. It uses process-local offline mode and loopback API
configuration. Generated exports are outside Git.

## Limits and integration

No schema or dependency change is required. Recommendation snapshots can still
expire through the existing TTL, capacity limit or server restart, with explicit
Refresh recovery. A rejected stale detail read can require another tap; combined
home-refresh failure may conservatively keep Refresh available after the head
itself succeeds. The long-inbox acceptance remains documented in
`PC_PRIVACY_RELIABILITY_2026-11-10.md` and its measured JSON receipt.

Windows Metro/Hermes/source-map checks do not establish Xcode compilation,
native linking, signing, launch, UIKit/Fabric layout, gestures, VoiceOver,
Dynamic Type, keyboard, lifecycle or physical-device performance. Mac combined
7260456, keyboard 407aa2f, messaging bbae706 and calendar c45b153 plus uncommitted
Mac work remain a separate recovery/integration task. No phone, Mac, production,
dirty D: checkout, recovery download, push, remote merge or deployment is used.
