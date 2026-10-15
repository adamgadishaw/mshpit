# Mobile development dependency advisory ledger

Snapshot: 2026-10-15. The reviewed lockfile uses Expo 57.0.29 and nested Expo CLI 57.0.30. The full audit lists **19 affected package-level entries inherited from two distinct advisories**, not 19 separate vulnerabilities. Neither advisory currently has a published patched version. Registry latest remains braces 3.0.3 and node-forge 1.4.0. No dependency override, forced fix or Expo 44 downgrade was applied.

## 1. braces 3.0.3 — stack exhaustion

- **GHSA:** [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
- **CVE:** [CVE-2026-93687](https://nvd.nist.gov/vuln/detail/CVE-2026-93687)
- **Affected range:** <=3.0.3; patched version: none published.
- **Installed path:** root development dependency `expo@57.0.29` → `@expo/metro-config@57.0.13` → `@expo/metro@56.0.2` → `metro-file-map@0.84.5` → `micromatch@4.0.8` → `braces@3.0.3`.
- **Exploit prerequisite:** adversarial deeply nested brace syntax must reach the vulnerable pattern parser/compiler/expander. Being installed or receiving an ordinary filename does not alone establish that path. The advisory describes recursive processing exhausting the Node call stack.

Installed Metro's watcher builds glob patterns from its extension and watcher configuration (`metro-file-map/src/Watcher.js`) and passes them to `watchers/common.js` / `micromatch.some`. The file path is the candidate string; the configured globs are the patterns. This review did not demonstrate an app API request reaching an attacker-controlled brace pattern, and did not execute a denial-of-service payload. Untrusted build/configuration inputs remain a host-tool concern. Keep the distinction between a vulnerable installed package and proven reachability.

## 2. node-forge 1.4.0 — RSA verification

- **GHSA:** [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv)
- **CVE:** [CVE-2026-85393](https://nvd.nist.gov/vuln/detail/CVE-2026-85393)
- **Affected range:** <=1.4.0; patched version: none published.
- **Installed paths:** `expo@57.0.29` → nested `@expo/cli@57.0.30` → `node-forge@1.4.0`, and the same CLI → `@expo/code-signing-certificates@0.0.6` → `node-forge@1.4.0`.
- **Exploit prerequisites:** attacker-crafted RSA PKCS#1 v1.5 verification input must reach the affected verifier under a low-exponent RSA key. The issue concerns extra nested DigestAlgorithm elements being accepted. A library import alone does not prove such an input/key path.

Installed Expo certificate helpers call forge for certificate verification, generated-signature self-checks and CSR checks. CLI's project certificate path reads the selected certificate/private-key files and validates their relationship; the helper's default RSA generator uses forge's default exponent 65537. No custom project code-signing certificate was found in app configuration. These observations narrow the reviewed call sites; they do not establish that every CLI or forge entry point is safe. No credentials or certificate files were created/read for this assessment, and no signature-forgery payload was executed.

## Runtime and build boundaries

Neither braces, micromatch nor node-forge occurs in the final Android/iOS export source-map graphs (2,040 / 2,043 sources). Application/server source import searches also did not find direct use. `react-native-share` is present in both mobile graphs; its native requirement is separate from these advisories. The full installed host toolchain remains affected. The current Metro listener is bound to 127.0.0.1; that observation is not a general exploitability proof or a substitute for upstream fixes.

The separate server-only `npm audit --omit=dev` returned zero findings. Existing production prune checks reject retained Expo/Metro/CLI/forge tooling. That narrower result does not clear the installed development graph, other consumers, future imports or future releases.

Evidence: `.tmp/overnight/sdk-patch-full-audit.json`, `advisory-braces-paths.txt`, `advisory-forge-paths.txt`, `sdk-patch-runtime-graphs.json`, installed package source, and the two official advisory pages above. Recheck upstream fixes before future dependency work; apply a supported compatible fix when one exists and rerun the relevant checks. Do not make broad incompatible changes solely to reduce npm's inherited package-entry count.
