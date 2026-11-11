# Offline iOS export-isolation gate

Run this after the existing Expo SDK 57 exports finish, using the same runtime
revision for both artifacts. It reads existing files only; it never exports,
downloads sources, accesses the network, installs packages or modifies artifacts.

```sh
node scripts/check-ios-export-isolation.mjs \
  --android-map .tmp/android-REV-regression/_expo/static/js/android/index-HASH.hbc.map \
  --web dist
node --test scripts/check-ios-export-isolation.test.mjs
```

Use Node 24, with `TMPDIR=/tmp` for hermetic tests. `--web` accepts an export root
or one explicit external source map. Directory mode checks every map and requires
an adjacent external map for every JavaScript chunk below `_expo/static/js/web`,
including lazy chunks. Public static boot scripts outside that Metro subtree are
not covered. Single-map mode checks only the supplied map, not a complete web
export. Inputs must be finished, trusted local export artifacts. Symlinked maps
and subtree entries are rejected. Flat v3 maps are supported; indexed maps and
missing/empty/malformed map structures fail closed. No source files are fetched.

The bounded JSON result goes to stdout, with exit 0 on success and 1 on failure.
Optionally pass `--report /path/outside-artifacts/new-report.json` to create a new
report. Existing files are never overwritten; output inside input artifact
directories is refused. Parent directories must already exist. Map filenames and
app-relative source names replace host-specific paths; source content is omitted.
At most 100 issues are retained, with total/omitted counts.

The checks reject application `.ios.*` implementations and the four explicitly
confined domains `iosMessageDrafts.mjs`, `iosFeedReturn.mjs`,
`iosSearchAnnouncements.mjs` and `sessionValidationStatus.mjs` in Android/web.
`node_modules` and native `Pods`
implementations are excluded. Other shared `ios`-prefixed helpers are deliberately
allowed. Relative, absolute and file-URL source names, sourceRoot and Windows
separators are normalized without resolving or reading original source files.

If retained in a map, the defaults `messageDraftOwner.js`, `useIOSFeedReturn.js`,
`useIOSSearchAnnouncement.js`, `sessionValidationStatus.js` and
`SessionValidationPending.jsx` must contain their reviewed inert implementations
in sourcesContent. Comments/whitespace do not matter; executable changes require
reviewing the gate's explicit contract. Their absence is allowed for tree shaking.
Other defaults remain covered by existing source/component tests, not assertions
that every unused noop must survive a compiler change.

This is source-isolation evidence, not accessibility, behavior, performance,
native-device or release certification. It does not validate source-map mappings
against compiled bytes, prove artifact freshness or replace review of default
platform behavior. Keep the existing 512 KiB web budget and full release/test
gates unchanged. Do not build again solely for this test/tooling-only change.
