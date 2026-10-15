# Video converter review — 2026-10-13

Local preparation only. Branch `fix/video-converter-20261013`, base
`81e63f7753b92d338f5707f33a40316d49638294`, in an isolated repository at
`2026-10-13/task-2/mshpit-video`. No push, merge, deployment, live job retry,
production record mutation, credentials or permission changes. The newsroom
photo fix `e1b8084` is separate. The original checkout remains untouched.

## Findings and changes

Independent review reproduced two defects in the first local candidate: a
signal-killed child was terminalized as a decode failure, and selected-stream
continuity incorrectly used whole-container length. Both failed new desktop
regressions before correction and now pass. These are defects in the local
upgrade, not reproductions of the original production failure below.

The supplied production evidence proves that source transfer/probe passed and
FFmpeg completed before the generated MP4 probe threw `unsupported_media`.
It does **not** identify the failed predicate. Deleted original/derivative
files and missing probe fields prevent an exact local reproduction. None of
the synthetic fixtures establishes the original production root cause, and
no account correlation proves these attempts belong to `@tonys1998`.

The classification defect is confirmed in code: a generated-output rejection
used the same code as unsupported original input, selecting HTTP 415. Named
checks now distinguish source validation, generated metadata, conversion and
full generated decode. Private logs contain fixed stage/predicate names and
expected/observed numbers, booleans or null; no raw FFprobe metadata, decoder
stderr, local paths, object identities or signed capabilities.

Signed deterministic worker failures map to `MEDIA_CONVERSION_FAILED` / 500 /
`PIT-UPLOAD-007`, with concise support guidance. Durable processing stops their
automatic retry after one attempt. Process signals and identified allocation failures get one transient retry; storage availability and contention
retain existing bounded transient retries. Queue recovery, idempotency,
generation-bound download, create-only upload, single slot and cleanup remain.
No database migration is needed. Older web code will treat the new worker
failure as transient, so both sides need coordinated release review later.

Delivery additionally requires H.264 8-bit yuv420p, progressive video, explicit
square pixels, bounded dimensions/FPS, cleared rotation, AAC-LC mono/stereo or
intentionally silent input. Stream-copy explicitly writes SAR in the H.264
bitstream. Conversion checks format and per-stream durations and relative A/V
start offsets. It selects the supported default audio track and downmixes;
audio that exists but cannot be decoded is no longer silently discarded.
Rational frame rates are retained without integer rounding. Upload byte,
duration, sample and coded-pixel limits stay intact; known source frame counts
now also contribute to the universal work budget. No `-t`, `-fs` or `-shortest`
is used to truncate deliveries.

PQ/HLG BT.2020 metadata selects explicit float-linear tone mapping and BT.709
SDR output; incomplete HDR metadata rejects rather than guessing. HDR cannot
take the copy shortcut, and its frame side data is removed after conversion.
The policy uses a fixed 1000-nit peak/100-nit reference and Hable/desaturation;
it is not dynamic Dolby Vision rendering or calibrated HDR display proof.
The image adds pinned libzimg 3.0.4+ds1-1 for zscale while keeping its network
disabled FFmpeg build and non-root runtime. See the primary
[FFmpeg filter documentation](https://ffmpeg.org/ffmpeg-filters.html#tonemap)
and [Debian package version](https://packages.debian.org/bookworm/libzimg-dev).
CRF 21/veryfast remains. Encoder threads are explicitly limited to two video /
one audio threads; filters retain one thread. The deployment plan is unchanged.

## Local validation

The corrected subprocess runner distinguishes signals, identified allocation
failure and ambiguous Windows exit 1 from explicit normal decode errors.
Their signed HTTP 503 replies preserve transient semantics through conversion,
generated decode and poster handling. Queue tests prove one retry followed by
a bounded stop after two process failures; normal storage recovery remains
separate. A real stdout-overflow test uses the actual worker HTTP 503 contract
and maps to terminal conversion failure. The runner now waits for process/pipe
close before rejecting overflow, fixing an aggregate-test Windows temp-directory
cleanup race (`EBUSY`).

Selected video/default-audio timeline measurements are separate from conservative
whole-source duration/work and bitrate budgeting. A real 5 s H.264 + default
1000 Hz AAC + nondefault 10 s / 500 Hz AAC case now delivers 5 s, selects the
1000 Hz track, and still budgets 10 s. Source-over-limit and true selected-media
truncation/sync guards remain tested. Unknown selected-track metadata is explicitly
unknown, not asserted to equal a longer excluded-track container timeline.

Poster encode, metadata process/parse, dimensions, orientation, byte inspection
and full decode now have safe named generated-artifact diagnostics; process
interruption and availability pass through as transient. Real signed process
and output-cap tests, plus generated-stage regressions, cover these boundaries.

The earlier PQ/HLG testsrc2 cases validate filter execution/metadata, not HDR
highlight energy. A new linear-light grayscale fixture has decoded PQ levels
approximately `[0, 0.101, 0.508, 1.010, 3.972, 10.042]` relative to 100 nits.
It exposed unsuitable RGB metadata for desaturation luma coefficients. The
filter now states BT.709 for that calculation, restores GBR before final
conversion, and uses Hable. Decoded SDR levels are approximately
`[0, 0.040, 0.179, 0.313, 0.729, 1.000]`: monotonic, bounded, with separated
400/1000-nit bands. This is a tested synthetic signal/range contract, not
calibrated color, full gamut or physical-device HDR appearance. FFmpeg's
[tone-map implementation](https://github.com/FFmpeg/FFmpeg/blob/master/libavfilter/vf_tonemap.c)
uses frame colorspace to select desaturation luma coefficients even for RGB.

The build self-test grows from six to twelve cases: the original AVI,
Matroska, WebM-labelled, interlaced MPEG, portrait and anamorphic cases plus
1080p rational rate, VFR, PQ, HLG, a real-energy PQ highlight/range case, and a reusable rotated HEVC Main 10 / AAC 5.1
MOV. The binary fixture is generated test content with documented SHA-256 and
generation instructions in `server/fixtures/README.md`.

`scripts/verify-video-converter.mjs` produces larger reusable synthetic cases,
validates full decode and faststart atom order, compares decoded first-frame
pictures, measures selected audio tone and stream timestamps, repeats processing
and compares exact output bytes, and interrupts an actual FFmpeg process.
Optional `--browser` plays the resulting files to completion in loopback-only
desktop Chromium. It needs a locally available Playwright module/browser, and
does not touch app records or external media.

Measured Windows FFmpeg 9.0.2 results (not the production FFmpeg 9.0.1 image):

| Case | Source / delivery duration | Picture/audio checks |
| --- | --- | --- |
| 1080p 30000/1001 H.264/AAC, 25,051,525 bytes | 10.010 / 10.010 s | Remux; decoded first-frame pixels identical; 1000 Hz selected tone |
| 24000/1001 silent H.264 | 4.004 / 4.004 s | No audio; decoded first-frame pixels identical |
| 720p VFR, six-channel default track, delayed second audio | 10.006 / 10.006 s | H.264/AAC stereo; default 1000 Hz track selected over first 500 Hz track; first-frame MAE about 0.10/255; start-offset change 21.334 ms |
| 90° rotated HEVC Main 10 HLG MOV / AAC 5.1 | 3.003 / 3.003 s | 640×360 becomes 360×640 once; rotation cleared; BT.709 SDR; spatial/color correlation about 0.945; 1000 Hz audio |

Every local output fully decoded and had `moov` before `mdat`. Repeated output
bytes were identical, and interrupted FFmpeg returned `job_cancelled`.
Desktop conversion/probe/full-decode took roughly 0.7–6.5 seconds for these
short cases; monitoring adds overhead. Observed converter process peak working
sets were about 70–130 MiB, with CPU observations up to 8.64 seconds for the
VFR/downmix case. Short processes can finish before the monitor samples them;
missing observations are null, not zero. These are scoped process observations,
not total verifier RSS, a 1 CPU container benchmark or worst-case 4K/ten-minute
acceptance. Headless Chromium played all five outputs to the end with expected
geometry; it reported dropped frames under this desktop test workload, so this
does not establish smooth physical-device playback.

Focused regression/documentation checks pass 182 cases, including named generated rejection,
no premature upload, temp cleanup, signed error mapping, deterministic retry
termination/restart, source-work bounds and audio selection. Ordinary aggregate
tests pass 6,274 cases with zero failures and one existing Windows symlink skip.
Syntax (850 Node files), architecture, Expo web export and bundle budget pass;
web JavaScript is 507.2 KiB gzip against 512 KiB. Read-only `npm audit --omit=dev`
reported zero vulnerabilities.

The native `npm run check` invocation is **not claimed to pass** on this
executor: normal execution stops at the restricted registry audit request;
elevated execution cannot inspect Git's tracked-file set in two repository
privacy tests (Git exits 128). Its constituents were checked separately in their
working environments. Git trust/permissions were not changed to bypass this.

## Release checks still blocked

- Exact Linux Docker image build and self-test: Docker is unavailable on this
  desktop. The pinned image, linked zimg runtime and FFmpeg 9.0.1 need that gate.
- Real affected clips and exact original final-probe predicate: files were
  deleted; no private member media was downloaded and no live jobs retried.
- Physical iPhone/Android, calibrated HDR appearance, full-clip perceptual
  quality/lip sync, worst-case 4K/500 MiB/ten-minute CPU/RAM, 20-clip p95 and
  30-minute stability/outage canaries: not performed. Headless decoded picture
  and timestamp checks are narrower evidence.
- The runbook canary rows I–K now follow negotiated universal capability and
  current 500 MiB/ten-minute/work limits, rather than obsolete blanket 60 s /
  100 MiB / MOV / HEVC rejection. Existing physical-device and performance gates
  remain release requirements. No release is authorized by this review.

## Follow-up environment/access checks

A narrowly scoped local CI proposal is in `.github/workflows/video-converter.yml`
and `.github/video-verifier-buildkit.toml`: changed-converter PR paths/manual
trigger, read-only repository permission, pinned checkout, bounded 1 CPU/2 GiB
BuildKit, exact Dockerfile build with local image load only, offline non-root
self-test and service regressions, then five-case synthetic acceptance with
container stats/exit-state observations. Runtime root is read-only, network is
disabled, PIDs and temporary storage are bounded. Build cache GC targets 8 GB;
that is not a hard disk quota. YAML/security-policy and TOML parsing pass locally.
The proposal is unpushed and has not run or enabled any hosted/paid service.
It does not yet establish exact-image readiness or worst-case/stability gates.

Docker, Podman and nerdctl were not found on PATH; Docker Desktop and Podman's
standard install paths were absent. No Docker/Podman/Rancher installation was
found in the inspected Program Files or WinGet inventory. WSL's status command
exits 50 and its listing command exposes only the installation/help stub; it
does not provide an installed Linux container execution route. No software,
Windows features, daemon or permissions were installed or changed.

The smallest next build action is to provide an already authorized Linux Docker
runner (local or existing CI), rather than deploy or install software here.
Build this exact Dockerfile in a runner/VM bounded to 1 vCPU, 2 GiB RAM and
finite build/scratch storage. Its image self-test is the first gate. Then run
the built image with 1 CPU/2 GiB, networking disabled, read-only root and a
bounded temporary filesystem; invoke `node server/videoVerifierService.js
--self-test`. Mount the offline harness read-only for further synthetic tests,
and collect container-wide cgroup CPU/RSS and wall time. Extended resource cases
should include 1080p60/ten-minute and 4K workloads within the existing coded-work
budget, plus near-500 MiB input; a 4K/ten-minute combination exceeding that budget
must reject. No resource ceiling or timeout should be raised to make it pass.

Existing authorized account-correlation access was checked narrowly: the Render
CLI is absent from PATH; Windows OpenSSH exists, but `ssh-add -l` exits 2 with
no agent connection, `.ssh/config` is absent, and `.ssh/known_hosts` is denied
by the executor. No existing SSH authorization could be established. The
available Render connector exposes no SSH or SQLite query tool (its database
query tool is Postgres-only). No authentication attempt to the production SSH
host, new login/key/grant, SQLite open, lease-renewing media GET or member-media
download was made. Therefore the upload-to-`@tonys1998` join remains unverified.

The normal npm wrapper's exact failure is the POST advisory request to
`https://registry.npmjs.org/-/npm/v1/security/advisories/bulk`: npm reports
`audit endpoint returned an error` with an undefined reason. A separate permitted
read-only audit succeeded with zero vulnerabilities. The elevated whole wrapper
fails the two repository privacy tests because `git ls-files -z` exits 128;
the tests do not retain its stderr, so a more specific ownership/permission
cause is not established. These Git privacy checks pass in the normal executor,
including after staging the reviewed files. No Git trust or permissions were
changed to work around the restriction.
