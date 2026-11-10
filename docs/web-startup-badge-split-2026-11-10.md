# Web startup budget after device-feedback integration

The combined candidate initially measured 524,920 gzip bytes, 632 bytes over the existing 524,288-byte limit. The limit and its measurement script are unchanged.

The startup source map showed the complete badge catalog, including achievement legend copy and progress-display functions. Startup requires status definitions and award predicates/points, while the complete achievement presentation belongs to the existing lazy BadgeLegend screen.

Changes:

- `achievementRules.mjs` owns achievement IDs, points, and award predicates. Store and profile count consumers import these rules directly.
- `statusBadges.mjs` owns the unchanged status definitions. Badge rendering and profile selection validation import them directly.
- `badges.mjs` retains its complete public API by combining award rules with legend presentation fields. Only the lazy BadgeLegend screen imports this catalog in the web graph. Server imports continue to work.
- Avatar original-image preference is explicitly iOS-only. Expo folds the platform condition out of the web bundle; native image recovery behavior is retained.

Final serial Expo web export passes at **524,235 gzip bytes**, with **53 bytes headroom**. The generated source maps confirm `badges.mjs` is absent from all initial scripts. The report is `.tmp/feedback-export/web-bundle-budget.json`.

59 focused badge, Store, avatar, and native image recovery tests pass. `git diff --check` passes. No dependency, budget, build-signing, deployment, or profile mutation changes.

Backend coordination: copying the new `profileBadges.mjs` requires `statusBadges.mjs`; copying the new `badges.mjs` requires both new modules. An already prepared backend candidate using the previous complete catalog can remain unchanged.
