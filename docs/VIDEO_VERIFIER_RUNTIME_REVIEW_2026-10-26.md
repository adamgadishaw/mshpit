# Video verifier runtime review - 2026-10-26

## 2026-10-27 security acceptance follow-up (local review checkpoint)

Draft [PR 79](https://github.com/adamgadishaw/mshpit/pull/79) published the original
four-file update at `beeb1e23388fc3a891a98a38b3a570bc223cca5b`. Its complete tree
`c1c7b58df9661a833aa3e8d5cd695accd7bf5397` equals local commit
`9e470cc70bc4be9c6956b74fba623eb2e550cb45`. Their commit metadata differs;
content, tree, parent and message do not. A normal fetch of the PR branch failed
before connecting to github.com:443 on October 27. No reset, force update,
ownership or Git security-setting change was attempted.

The original head passed [Quality](https://github.com/adamgadishaw/mshpit/actions/runs/40421357857)
and [Video converter image](https://github.com/adamgadishaw/mshpit/actions/runs/40421358001).
Quality normal/hosted suites each passed 7,004 tests and both jobs passed, but its
runner used Node 24.21.0. Image CI pulled the pinned base, executed both CA apt
layers (ca-certificates 20250419~deb12u2), passed both 15-fixture self-tests,
95 service tests, and the five-case offline harness without OOM. This establishes
CI image execution, not production remediation. Original terminal logs and
publication evidence are preserved separately in the task workspace.

The owner approved this follow-up for the same draft PR, subject to independent
review before publication. This new candidate is local/uncommitted and has not
run CI. No merge, auto-merge, deployment or production test traffic is authorized.

### New gates and their boundaries

- `scripts/verify-video-verifier-security.mjs --inventory` runs in the built
  non-root image, offline. It prints actual `process.version`, OpenSSL, platform,
  architecture and UID and requires stable Node >=24.22.1 within major 24.
  It records the installed Debian CA package, OS bundle/config SHA256, and
  subjects, issuers, validity dates, certificate/SPKI SHA256 fingerprints and
  counts for the OS bundle and Node default/bundled/system/extra CA lists.
  Merely listing a root is not proof it remains usable: Node's blocked-key
  policy is separate from its root list.
- `--network` runs in a separate bounded bridge-network container. It uses the
  same ordinary `globalThis.fetch` trust path as videoVerifierService, with
  credential-free HEAD requests, no redirects followed and 15-second deadlines.
  The valid-chain control is `https://nodejs.org/`, before and after both
  negative endpoints. It must produce HTTP 2xx/3xx. Either negative endpoint
  producing any HTTP response fails the gate.
- Both Render-recommended endpoints must fail specifically with
  `CERT_REVOKED`: `dv-g3b-emudhra.we-have-a-problem.com` and
  `dv-g3b-aaa-emudhra.we-have-a-problem.com`. Expiry, hostname mismatch,
  missing issuer, DNS, timeout and other transport errors fail the check;
  none is counted as successful rejection.
- A separate TLS-only observation socket reads each public peer chain. Its
  per-socket `rejectUnauthorized: false` permits inspection, sends no HTTP or
  other application data, and is never counted as certificate acceptance.
  It must itself report unauthorized/CERT_REVOKED. There is no global/default
  trust change, CA insertion, internal Node blocklist hook, private key or
  certificate-store write. The independent fetch uses default verification.
- Observation verifies current validity and hostname, issuer/signature links,
  the exact pinned intermediate fingerprint and blocked SPKI, and the remaining
  pinned peer-sent issuer chain. It permits leaf renewal only under the same
  pinned intermediate. Actual chain details and error reasons go to the CI log.
  Observation and fetch use separate TLS connections; the log is not an atomic
  capture of the fetch connection. No custom dispatcher is installed to change
  the application's trust path.
- The check refuses trust/proxy environment overrides and Node CLI overrides.
  CI passes no application credentials. Only the dedicated security container
  has bridge networking; all existing decoder/media containers retain network
  none, non-root, read-only, no capabilities/new privileges, 1 CPU, 2 GiB
  memory/no swap growth, 128 PIDs and 768 MiB /tmp. The production Dockerfile,
  service, build command, decoder tests and media policy are unchanged.
- New path filters ensure edits to the script, regression test or public
  fixtures trigger image CI. Both security steps are mandatory with no
  continue-on-error. No existing gate is removed.

### Authoritative provenance and authentic fixture limits

Rechecked [Render guidance](https://render.com/docs/advisory-emudhra),
[Node security advisory](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)
and the [24.22.1 release](https://nodejs.org/en/blog/release/v24.22.1/).
The release tag resolves to Node commit
`ce7aaf1cee78b8cf0ce17364260535c418d3ed26`.
Its [crypto implementation](https://github.com/nodejs/node/blob/ce7aaf1cee78b8cf0ce17364260535c418d3ed26/src/crypto/crypto_context.cc)
contains the blocked SPKI
`ebed6475c2c2d80fcb199f3fe8dd6e6b3ce60b77eb15d4e42c3dec0c6f5b5105`
and deliberately reports `X509_V_ERR_CERT_REVOKED` / `CERT_REVOKED`.
The [versioned TLS API documentation](https://github.com/nodejs/node/blob/ce7aaf1cee78b8cf0ce17364260535c418d3ed26/doc/api/tls.md)
documents the CA inventory and peer-chain APIs used here.

Render links the public [test-site source](https://github.com/galadran/we-have-a-problem.com).
The two PEM chains and metadata were retrieved at immutable revision
`47cc4b8c338443d2f85b2526ac7e49c067ad7d2a`; their original bytes are embedded
in `scripts/fixtures/video-verifier-security.json`, with source paths and Git
blob IDs. Independent computation matches blobs
`ad8f25d298de8807590544ed59d4fd1d780d91d8` (eMudhra) and
`10f6cbde87a8d0f16c15a91e0c904d32a5c4eded` (AAA).
Certificate DER SHA256 matches the upstream impacted-intermediates manifest:
`42c4accd12c4f59597925e1a08a7a90102608543809308d50ec427e118ba1493`
and `45a883f349aedfd5f3a649b5498ffb121712ba8b448f3f2a91dbc5a766fcddbe`.
Both yield the same official blocked SPKI above.

Fixtures contain public certificates only. Their leaves were valid October 20,
2026 through May 3, 2027. Offline regression tests validate provenance,
signatures, classification and validity at the recorded October 27 snapshot.
They do not prove a live TLS handshake or change certificate trust. An authentic
offline server cannot be instantiated with these public certificates alone;
no private key was retrieved, generated for these identities or derived.
The online gate therefore depends on the public endpoints being reachable and
serving the expected chain. Certificate/issuer changes or endpoint outages fail
closed and require inspection, never a blanket error allowance.

### Validation checkpoint and remaining acceptance

- Focused local regressions: the four verifier suites plus eleven new security
  regressions pass (166 tests, zero failures/skips), including early TLS socket
  closure (must reject instead of allowing a silent process exit).
- Public fixture Git hashes, certificate SHA256, blocked SPKI, hostname,
  signature and recorded validity checks pass. A mutated-signature regression
  fails as intended. Trust overrides and expiry/network errors cannot satisfy
  the negative assertion.
- Actual local Node is 24.16.0; the CLI runtime guard rejected it with exit 1
  and reported its actual version, as intended.
  Docker is unavailable locally. The new image inventory and online gate,
  including the real valid-chain control and actual CERT_REVOKED results,
  remain unrun until reviewed changes are published and exact-head CI completes.
- Full local aggregate tests, dependency audit and Expo export remain unavailable
  without the complete dependency installation. Prior-head CI passes do not
  apply to this new candidate. Syntax (910 Node files), architecture and
  whitespace checks passed; final focused reruns are preserved in the review
  handoff after the socket-close regression was added.
- The two endpoints cover the DV G3B key through eMudhra and AAA chains, not all
  eight compromised keys. No dedicated TLS-hostname/Brotli exploit regression,
  physical-device/worst-case media acceptance or production security claim is
  made.
- After independent review, publish only these scoped changes to the existing
  draft, verify exact published bytes/tree and monitor its exact-head Quality
  and image runs to terminal. Inspect failures before changing code or gates.
  Merge/deployment requires separate scope. A future authorized deployment must
  record its own final image/deploy IDs, runtime, CA rejection/control and
  signed readiness/media behavior. Rolling back to the old Node 24.19.0 image
  reintroduces the original runtime/CA exposure; retain a patched rollback
  artifact.

## Initial preparation record (historical)

The original October 26 local-only record below is preserved for provenance.
Its publication/CI status is superseded by the checkpoint above.


Local preparation only. Branch `fix/video-verifier-node-ca-refresh` starts at
GitHub master `60ff9d3445144137fc619be4347ffd4291a1f86a`, tree
`b668bf92890826dae8db922b13986612fbf8dbb9`, independently checked through the
connected GitHub API before preparation and again after the edit. This is
separate from PR 78 reliability and PR 74 search work. Nothing is committed,
pushed, opened as a PR, merged or deployed.

## Scope and supplied operational evidence

The delegated investigation supplied these observations; this task did not
repeat production access:

- Main web live commit `60ff9d3445144137fc619be4347ffd4291a1f86a` explicitly built
  with Node 24.22.1.
- Independent private verifier `srv-da6e15ou01pc73fo3100` had live deploy
  `dep-dbei2ceq1p3s73ea5lug`, October 24 at 21:21:18 UTC, using commit
  `ee39459677b287d7c54c073b35b63c7f151d4550`.
- That verifier build resolved both stages to
  `node:24.19.0-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03`.
  Its runtime `ca-certificates` installation layer was cached. This is a base
  image digest, not the final deployment image digest.
- Runtime `process.version`, installed CA package and actual rejection of the
  compromised certificate chains were not verified. These findings do not
  establish a breach of mshpit.
- The parent subsequently read the authenticated Render advisory email dated
  October 26 at 22:13:03 UTC. It also identifies Node TLS hostname checks and
  Brotli decompression vulnerabilities. PHP applicability is being researched
  separately; no PHP work is included here.

## Official guidance and selected change

[Render's advisory](https://render.com/docs/advisory-emudhra) requires Node
24.22.1 or later within Node 24 and an updated Docker CA store followed by a
rebuild. Render states its platform was not compromised. Its temporary CA-mode
workaround is not used here.

The [Node October security advisory](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)
and [24.22.1 release](https://nodejs.org/en/blog/release/v24.22.1) identify TLS
hostname-validation fixes, the Brotli decoder out-of-bounds-write RCE fix
(CVE-2026-111497), and certificate-chain/public-key rejection and root updates.
Consequently the Node runtime upgrade matters independently of framework or
outbound HTTPS usage; a CA-only adjustment would leave other runtime flaws.

Only the shared `NODE_IMAGE` changes executable behavior. It now selects:

```text
node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205
```

Both `FROM` instructions still use that one argument. Node remains on 24 and
Debian on Bookworm Slim. Every Docker instruction after the image argument is
byte-equivalent after newline normalization to current master: FFmpeg 9.0.1
source/hash, x264/zimg pins, network-disabled decoder build, smoke decode,
non-root self-test and runtime entrypoint are retained. Service code, upload
admission, signed protocol, time/work/size limits, resource settings and
`render.yaml` are untouched. The existing deployment test now guards the new
exact pin and both stages' use of it. STATUS and this audit record the checkpoint.

## Image provenance and its limits

These are immutable upstream references retrieved through the connected GitHub
API, cross-checked against the official Docker/Node sources viewed over HTTPS:

1. [Docker Official Images library definition](https://github.com/docker-library/official-images/blob/74ff70c42bd53c80b1fed4e20308d6f340f20a30/library/node)
   maps `24.22.1-bookworm-slim` to `nodejs/docker-node` commit
   `80f02a542da739e6a662451d1db66456a0dea253`, directory `24/bookworm-slim`.
2. [That exact Node Dockerfile](https://github.com/nodejs/docker-node/blob/80f02a542da739e6a662451d1db66456a0dea253/24/bookworm-slim/Dockerfile)
   specifies `NODE_VERSION=24.22.1` and verifies the downloaded Node archive
   against GPG-authenticated release checksums during its upstream build.
3. [Docker's published image metadata](https://github.com/docker-library/repo-info/blob/db455fb087ca27645319a0186c0f85b832545618/repos/node/remote/24.22.1-bookworm-slim.md)
   records the selected digest as an OCI multi-platform image index. Its
   Linux/amd64 child manifest is
   `sha256:2dd9a4f758e173b65fee15388f7706af6fb01ef50cf7a2c0538711d67a6981ae`;
   its amd64 image configuration ID is
   `sha256:dc1f22974dab4be31a8b56d58cb1f8fc218e83de83ccd831d885b3d7ac1223fb`.
   Index, child manifest and image configuration digests are distinct.

The exact digest is sourced from official-maintainer metadata, not guessed from
a tag. Saved content was independently hashed with Git's blob format and
matched the API's blob IDs: `d839726b804ed27363e67b7dccd9dd318026ab23` (image
metadata), `0ca4d12b463f12ac1f35ed62da0c324a20e746d8` (library definition), and
`196702aeea4672a221fe0c446410da741ec37fb9` (upstream Dockerfile).

This proves the recorded official-source provenance. It is not a local registry
pull, recomputation of the OCI manifest digest, independent image-signature
verification, or execution of the published binary. Those stronger checks were
not possible here. The upstream build recipe's GPG step was inspected, not run.

## Fresh CA layers

Both existing stages already combine `apt-get update` and explicit installation
of `ca-certificates` in a single layer, and remove the downloaded package lists.
[Debian's apt-get documentation](https://manpages.debian.org/bookworm/apt/apt-get.8.en.html)
confirms that `install` also upgrades specified installed packages to newer
available versions. No additional trust roots, replacement bundle, TLS bypass,
CA-mode environment override, host trust-store edit or distribution-wide upgrade
is introduced.

The new base changes both stages' cache ancestry. For acceptance and eventual
release, still rebuild with `--pull --no-cache`, as described in
[Docker's build guidance](https://docs.docker.com/build/building/best-practices/),
and retain logs proving both APT layers actually ran. The digest remains pinned:
`--pull` does not silently select a new digest. Latest available Debian package
selection alone is not proof of effective certificate rejection. Record the
installed package version and bundle hash, then perform the client-level tests
below. Do not invent a patched Debian package version or claim it is installed
until the image has been built and inspected.

## Local checks and environment

The checkout is owned by the sandbox execution account at
`2026-10-26/task-5/mshpit-verifier`. Direct GitHub cloning failed to connect to
port 443. A new independent clone with `--no-hardlinks --no-checkout` was instead
made from the already-owned `task-3/mshpit-master-review` object database, then
checked out at the API-verified master SHA. There is no Git alternates file.
No source-copy working files or pending reliability/search edits were copied.
The protected `D:\Development\Apps\mshpit` checkout was not accessed. No Git
safe-directory or ownership configuration changed. One other candidate source
was rejected by Git's ownership check and was not used.

Read `AGENTS.md`, the linked Expo SDK 57 reference, `CLAUDE.md`, `BRIEF.md`,
`STATUS.md`, `SCALING.md`, `SECURITY.md`, `MIGRATION.md`, `ERROR_CATALOG.md` and the
existing converter review/CI. Neither the verified tree nor the owned source
contains `.agents/skills`; there were no repository skills there to apply.
The explicit local-only instruction overrides the guide's standing release rule.

The host Node is **24.16.0 on Windows**, not the proposed Linux runtime. The four
verifier suites passed 155 tests before the edit and pass 155 after it, with zero
failures or skips. This covers deployment contracts, protocol, service and
client integration with synthetic/mock media plus local process/loopback cases;
it does not exercise the new Node binary or actual FFmpeg conversion.

Syntax validation passed for 908 Node files, the architecture gate passed, and
`git diff --check` passed. The source-provenance hash/invariant check also passed.

```text
node scripts/run-tests.mjs server/videoVerifierDeployment.test.mjs server/videoVerifierProtocol.test.mjs server/videoVerifierService.test.mjs server/videoVerifier.test.mjs
node scripts/check-syntax.mjs
node scripts/check-architecture.mjs
git diff --check
```

The focused tests use a private copy of the existing local `yaml` 2.9.0 package,
matching the lockfile version; no package manifest/lockfile changed. The full
`npm run check` aggregate, full app tests, registry dependency audit and Expo web
export are **not run** here: the fresh checkout lacks the full dependency graph
and direct network access is unavailable. No local commit is made without those
required checks. Exact syntax/architecture results and saved source-hash checks
are in the adjacent task evidence folder.

Docker CLI was absent from PATH and its standard install location. FFmpeg and
FFprobe were absent from PATH. No Docker build, exact-image self-test, offline
decoder harness, Linux container resource test, runtime CA test or production
traffic was run. No software, daemon, permission, credential or certificate
store was installed or changed to get around those limits.

## Future acceptance and deployment plan (not executed)

1. On an authorized Linux Docker runner, inspect the pinned reference with
   `docker buildx imagetools inspect` and record its index and amd64 child
   manifest. Pulling by digest must authenticate to the official registry over
   normal TLS and content-validate the manifests/layers. Do not use an insecure
   registry or substitute a mutable tag. Recheck official advisories if delayed.
2. Follow `.github/workflows/video-converter.yml`'s bounded BuildKit setup:
   one CPU, 2 GiB RAM, single parallel build and finite disk. Use a fresh owned
   builder and the unchanged exact Dockerfile, adding `--pull --no-cache
   --progress=plain` to its `docker buildx build --platform linux/amd64 --load`
   invocation. No `NODE_IMAGE` build-argument override. Build locally only;
   do not publish as part of acceptance. Retain logs, image ID and installed
   `ca-certificates` version. Confirm both CA layers are not marked `CACHED`.
3. Run the workflow's non-root `--self-test`, verifier service suite and
   `scripts/verify-video-converter.mjs` offline harness against that exact
   image. Preserve `--cpus=1 --memory=2g --memory-swap=2g --pids-limit=128`,
   `--network=none --read-only --cap-drop=ALL`, `no-new-privileges`, and the
   768 MiB `nosuid,nodev` temporary filesystem. Retain conversion, full-decode,
   stream preservation, exit/OOM and container resource evidence. Do not raise
   media/resource limits to make tests pass.
4. Inspect `process.version` in the built image (expected `v24.22.1`), the actual
   FFmpeg version (9.0.1), `dpkg-query -W ca-certificates`, and the SHA-256 of
   `/etc/ssl/certs/ca-certificates.crt`. Complete normal repository gates on the
   final candidate with the proper installed dependencies. A build/self-test or
   certificate-validation failure blocks release.
5. Return that evidence for separate release authorization. A later approved
   change must target private service `srv-da6e15ou01pc73fo3100` specifically.
   Its Blueprint tracks master with `checksPass` and includes the Dockerfile in
   its path filter; publishing/merging can trigger a deploy. Do not assume the
   web service's Node setting changes the verifier. Use a cleared build cache
   for the approved verifier rebuild and retain its exact commit/deploy/image
   identities and noncached build logs. No live action is authorized here.
6. After a separately authorized deployment, verify the actual process version,
   signed fresh decoder readiness and normal media capabilities. With explicit
   operational test authorization, use the verifier's real Node `fetch` client
   and deployed trust configuration to test both advisory endpoints:
   `https://dv-g3b-emudhra.we-have-a-problem.com/` and
   `https://dv-g3b-aaa-emudhra.we-have-a-problem.com/`.
   Both must fail specifically with certificate verification errors; any HTTP
   response is failure, and DNS/timeouts are inconclusive. A normal HTTPS
   control should succeed. Curl or a developer laptop is not equivalent.
   Review CA-override presence without printing secrets. Preserve sanitized
   outcome/error-code evidence, not environment or signed storage URLs.

## Rollback

There is no schema, protocol, data or credential migration. The runtime change
can be reverted independently, but restoring the old verifier image also
restores the known old Node runtime and potentially stale CA layer. That is not
a secure remediation and must not be treated as an accepted steady state.
Prefer correcting build/compatibility issues while keeping a patched Node image.
If emergency rollback is separately authorized, retain the failed candidate's
evidence, record the security regression and promptly roll forward. Do not
loosen media acceptance, signature checks, decoder isolation or resource limits.
