# Device feedback: native QA repack preparation

Status: prepared only. No JavaScript export, repack, signing, installation, or device interaction has been performed by this preparation task. Source is still being integrated and must be frozen before execution.

## Why repack

[Expo's official repack documentation](https://docs.expo.dev/build-reference/repack/) supports reusing an existing native binary for JavaScript-only internal QA when native fingerprints match. It supports a JS-bundle-only mode and source-map output. This produces a new artifact; it is not an OTA update or a full native compilation.

Disk space fell below 300 MiB during simulator initialization. A fresh native cache would require substantially more space: the prior iOS tree is 528 MiB and DerivedData is 2.8 GiB. Prior copied caches failed because Swift/Clang PCM and dependency scans embedded absolute paths, ultimately requiring regeneration of the copied Intermediates. Repacking avoids those compiler caches entirely and keeps the prior app and dependency trees read-only.

The iOS-native input diff from `bcd30cb` to current source is empty for package/lock files, app configuration, Babel/Metro/entry configuration, native modules/plugins, and assets. The installed `@expo/fingerprint` reports the same iOS hash for the verified prior source tree and this new worktree:

`a40b6a4ab10d8a7a6318dd8398be05804b77e666`

There are 134 prior versus 133 current descriptors. The sole structural difference is the absent generated `ios` directory with `hash: null`; it is ignored in both managed projects. No native directory was copied to force agreement. Evidence is under `.tmp/native-device-feedback/evidence/native-fingerprint-{prior,current,diff}.json`.

## Isolated tool and inspected behavior

`@expo/repack-app@0.10.4` is installed only under `.tmp/native-device-feedback/repack-tool` with its own package lock. App package files and runtime dependencies are unchanged. Registry integrity:

`sha512-7wHxMXWFv+dEEuURcbiiGmtDtSUGKjneoK/Q06CpSUsxvmzXAOzKcecFxVikOePsaa9Lkjm3XHlFsBTot+uq8Q==`

The installed implementation was read before choosing the workflow:

- `--js-bundle-only` bypasses native app/executable renaming, Info.plist, Expo.plist, and app.config metadata updates.
- Bundling invokes the current project's Expo CLI with Hermes bytecode and source-map output, and replaces the copied app's JavaScript bundle/assets.
- The CLI signing identity option invokes Fastlane, which is not installed here. Instead, the official tool will produce an unsigned isolated IPA. A separate explicit finalization step uses Apple's existing `codesign`, the exact baseline development identity, unchanged embedded provisioning profile, and the exact baseline entitlements. No private key export or account/keychain setting changes are needed.
- Nested frameworks remain byte-identical and retain their existing signatures. Only the outer application is re-signed; strict/deep verification checks the result.

## Prepared execution and verification

All scripts are in `.tmp/native-device-feedback/`; syntax checks passed. They have not been executed beyond preparation/fingerprinting.

1. After root confirms a final clean source commit, `python3 .tmp/native-device-feedback/freeze-source.py freeze <full-commit>` records all tracked source hashes.
2. `bash .tmp/native-device-feedback/repack-qa.sh` verifies that freeze and at least 768 MiB free space, APFS-clones the saved `bcd30cb` app into a new payload, creates a source IPA, and runs the pinned repack tool from the new source checkout. It does not sign.
3. `python3 .tmp/native-device-feedback/finalize-qa.py --expected-export-map <final-iOS-export-map>` verifies preservation, native payload and metadata, and exact source content/module-set agreement between final iOS export and repack maps. It prepares an unsigned candidate report.
4. Only after that succeeds, adding `--sign` performs existing-identity signing and strict verification, checks exact entitlements/provisioning/certificate preservation, verifies native executable code outside its signature blob, and produces the candidate IPA, app, manifest, and receipt. A signing timeout stops without attempting keychain changes.

`evidence/preservation-before.json` records all four saved candidates (`296ce4b`, `6417309`, `b1c9514`, `bcd30cb`), their adjacent receipts/manifests, the previous native project, previous dependencies, previous source checkout, source map, and current package locks. Finalization verifies those inputs remain unchanged.

Remaining gates: final source freeze/export, fresh compatibility check if native inputs change, actual repack/signature verification, and physical iPhone acceptance. Any result must be described as a QA repack of the verified native runtime, not a fresh native compile or a production-store release.
