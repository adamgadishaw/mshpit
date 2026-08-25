# Private-derivative-v1 video publishing runbook

Status: **the production verifier is Blueprint-provisioned and production video publishing is enabled after the gated infrastructure rollout.** `render.yaml` keeps `PIT_VIDEO_PUBLISHING_ENABLED=true`; revert it to `false` immediately if negotiated health, the production canary, or ongoing verifier health fails. The first infrastructure deployment remained disabled until private storage and signed verifier health passed.

Budget: the current topology adds **one production-only Render Starter private service in Oregon, about US$7/month** at the expected Starter floor. No staging verifier is provisioned by the Blueprint, so this rollout does not add a second approximately US$7/month service. Confirm the live [Render pricing](https://render.com/pricing) before changing plans or adding a staging verifier.

## What is being deployed

`private-derivative-v1` accepts a new clip only after PIT has:

1. uploaded an immutable MP4 source to a distinct private ingest bucket with no public URL;
2. checked its bounded MP4 structure and H.264/AAC sample tables;
3. granted the private verifier a short-lived, `If-Match`-bound signed GET for that exact object generation;
4. fully decoded the clip with FFmpeg, transcoded it to a metadata-stripped H.264/AAC public derivative, and independently decoded that derivative;
5. uploaded the derivative through a create-only signed PUT, then independently HEAD- and SHA-256-verified it from the control plane; and
6. generated the JPEG poster from the sanitized derivative and verified that poster before making the asset publishable.

The web control plane and private verifier authenticate both request and response with the shared HMAC contract `pit-video-verifier-v2`. The client opts in through `GET /api/health?mediaPipeline=private-derivative-v1`; the unversioned health route deliberately remains photo-only so older clients fail closed.

Source of truth:

- Contract and HMAC: `server/videoVerifierProtocol.js`
- Web-side health, timeouts, signed request, and response validation: `server/videoVerifier.js`
- Isolated FFmpeg/FFprobe service: `server/videoVerifierService.js`
- Generation-bound storage capability: `server/media.js`
- Finalization and authoritative poster provenance: `server/mediaAssets.js`
- Bounded MP4 admission: `server/mp4Probe.js`
- Capability, actor, and demand gates: `server/api.js`
- Health scheduler lifecycle: `server/index.js`
- Client negotiation: `src/domain/mediaPublishingCapabilities.mjs`
- Client preflight: `src/domain/mediaPublishingPreflight.mjs`

Current hard bounds are MP4 only, at most 100 MiB and 60 seconds, one progressive H.264 video track, at most one AAC-LC mono/stereo audio track, and one verifier job at a time. The server remains authoritative even when picker preflight passes.

## Render topology

The Blueprint defines a **production private service**, not a background worker, because the web service must make signed HTTP calls to it:

- service: `pit-video-verifier`
- type/runtime: Render `pserv` using `Dockerfile.video-verifier`
- plan/region: Starter in `oregon`
- branch/deploy: `master` with automatic deploys
- internal port: `10001`

Render private services have no public `onrender.com` address and are reachable only through the private network. The production web service receives `PIT_VIDEO_VERIFIER_HOSTPORT` from the verifier's Blueprint `hostport` property, so operators must not paste a public URL or manually construct a hostname. The verifier HMAC secret is generated on the private service and injected into the web service through a Blueprint `fromService` reference. See [Private Services](https://render.com/docs/private-services), [Private Network](https://render.com/docs/private-network), and [Blueprint YAML Reference](https://render.com/docs/blueprint-spec).

The container pins its Node base image by immutable digest and pins and verifies the FFmpeg source release before building it. Its image build includes an encode/probe/full-decode smoke test, and the runtime uses the fixed `/opt/ffmpeg/bin/ffmpeg` and `/opt/ffmpeg/bin/ffprobe` paths. A successful image build is necessary but is not sufficient to enable publishing; live signed verifier health and storage checks must still pass. Decoder/base-image security updates require a rebuild and repeat canary before rollout.

Do not scale this version above one verifier instance. Its concurrency and coalescing controls are process-local; horizontal scale needs a durable queue/shared lock first. Render recommends Docker where OS packages or reproducible builds are required; see [Docker on Render](https://render.com/docs/docker). Secrets belong in Render runtime environment values, never image build arguments or the repository; see [Environment Variables and Secrets](https://render.com/docs/configure-environment-variables).

## Exact environment separation

The current rollout provisions only the production verifier. It does not share a broad environment group with the web service. The verifier receives only its protocol secret, bounded bucket/origin identifiers, and decoder paths; it never receives storage credentials or application/database secrets. If a staging verifier is added later, it must be a separate service with separate buckets and a separate HMAC secret, and it will add its own recurring service cost.

### Web service only

Keep the existing database/disk, application, email, provider, and complete media credential set on the web service. The video-specific values are:

| Variable | Value |
| --- | --- |
| `PIT_VIDEO_PUBLISHING_ENABLED` | Blueprint value `true` after the separate enablement deployment; return to `false` for rollback or any failed health/canary gate |
| `PIT_VIDEO_VERIFIER_HOSTPORT` | Blueprint `fromService` reference to `pit-video-verifier` property `hostport`; never a public URL |
| `PIT_VIDEO_VERIFIER_SECRET` | Blueprint `fromService` reference to the verifier's generated `PIT_VIDEO_VERIFIER_SECRET` |

The web service retains `MEDIA_ENDPOINT`, `MEDIA_BUCKET`, `MEDIA_REGION`, `MEDIA_ACCESS_KEY_ID`, `MEDIA_SECRET_ACCESS_KEY`, and `MEDIA_PUBLIC_BASE_URL`, and adds `MEDIA_SOURCE_BUCKET` for private originals. `MEDIA_SOURCE_BUCKET` must be distinct from `MEDIA_BUCKET` and must not have a public custom domain. Production does not accept `PIT_VIDEO_VERIFIER_URL`; that variable is local-development-only. Do not reuse a staging secret, bucket, or verifier hostname in production.

### Private verifier only

| Variable | Value |
| --- | --- |
| `PORT` | `10001` |
| `PIT_VIDEO_VERIFIER_SECRET` | Generated by the Blueprint on `pit-video-verifier`; the paired web service reads this exact value through `fromService` |
| `PIT_VIDEO_SOURCE_ORIGIN` | Blueprint reference to production web `MEDIA_ENDPOINT` |
| `PIT_VIDEO_SOURCE_BUCKET` | Blueprint reference to production web `MEDIA_SOURCE_BUCKET` |
| `PIT_VIDEO_OUTPUT_ORIGIN` | Blueprint reference to production web `MEDIA_ENDPOINT` |
| `PIT_VIDEO_OUTPUT_BUCKET` | Blueprint reference to production web `MEDIA_BUCKET` |
| `PIT_FFMPEG_PATH` | `/opt/ffmpeg/bin/ffmpeg` |
| `PIT_FFPROBE_PATH` | `/opt/ffmpeg/bin/ffprobe` |

The verifier must **not** receive any R2/S3 access key, secret key, database URL/file/disk, `PIT_DATA_DIR`, admin credential, email credential, provider API key, backup credential, session secret, or `MEDIA_PUBLIC_BASE_URL`. In particular, do not set `MEDIA_ACCESS_KEY_ID`, `MEDIA_SECRET_ACCESS_KEY`, or any database credential on it. It downloads only the exact source identified by a short-lived signed URL and `If-Match` header supplied inside an authenticated job. Use the explicit `PIT_VIDEO_SOURCE_*` names rather than the compatibility `MEDIA_*` fallbacks so an environment audit is unambiguous.

Never print, copy into a ticket, or commit the generated HMAC secret. Rotate it only with publishing disabled and preserve the single Blueprint source of truth; a mismatched/one-sided rotation is expected to fail closed.

## Optional future staging enable sequence

No staging verifier is provisioned in the current production-only rollout. The following sequence applies only if the owner later approves the additional service cost and a separate staging verifier is added. Never point staging at the production verifier or either production bucket.

1. Run the repository quality gate (`npm run check`) and deploy the web code to `mshpit-staging` with its separate staging database, media bucket, and `PIT_VIDEO_PUBLISHING_ENABLED=false`.
2. Add a separate staging private service with port `10001`, the isolated verifier environment above, and the same pinned-container controls. Do not add production values.
3. Add the private hostport and matching HMAC secret to the staging web service. Keep the flag false and redeploy both services.
4. As an authenticated moderator, inspect `GET /api/admin/health`. Require `services.mediaObjectStorageConfigured=true`, `services.privateVideoSourceStorageConfigured=true`, `services.videoVerifier.configured=true`, `services.videoVerifier.ready=true`, `services.videoVerifier.pipeline="private-derivative-v1"`, no `lastErrorCode`, and a nonempty `ffmpegVersion`. With the flag still false, both health URLs must advertise `videos:false`.
5. Set the flag to `true` on **staging only**, deploy, and require the exact negotiated route to return `{photos:true,videos:true,pipeline:"private-derivative-v1"}` while unversioned `GET /api/health` still returns `videos:false`.
6. Run every canary case and performance gate below using real staging object storage and release-equivalent clients. A mocked FFmpeg call, unit fixture, or direct database edit is not a canary.
7. Disable the staging flag again after evidence is captured. Do not use a future staging exercise to alter production; production follows the separate sequence below.

## Exact staging canary matrix

Use a verified-email test account. Record client, source SHA-256, source bytes, declared and verified geometry/duration, poster SHA-256/time, create/upload/finalize timings, HTTP result, and Render deploy/FFmpeg version for every case.

Run `A`, `B`, `C`, and `H` on all three client paths: current Chromium web production build, a physical iPhone release build, and a physical Android release build. Run the remaining rows from at least one release-equivalent client. All successful cases must publish into a post, reopen after a cold app restart, show the authoritative poster before playback, and play to the end with sound behavior matching the source.

| ID | Real source/action | Required result |
| --- | --- | --- |
| A | Progressive ISO MP4, H.264 High, AAC-LC stereo, landscape 1920×1080, 30 fps, 10–20 s | Upload progress advances; finalize succeeds; poster/time/dimensions are correct; post survives reload |
| B | Phone portrait MP4 with real 90° or 270° rotation metadata, H.264 Main + AAC-LC | Verified display geometry and poster are portrait, not swapped, stretched, or sideways |
| C | Progressive H.264 Baseline MP4 with no audio, 3–10 s | Finalize succeeds and playback is intentionally silent |
| D | Valid 59.5–60.0 s H.264/AAC clip at 1080p60 | Succeeds inside the decode performance gate; no timeout or restart |
| E | Valid 95–100 MiB, at most 60 s MP4 | Direct upload completes within the client deadline, byte count matches, and authoritative finalize succeeds |
| F | Choose a cover time and finalize, then attempt to reopen or mutate that verified clip cover | Re-edit fails closed before PATCH or client-poster upload; the user must add the source again to choose a different cover |
| G | Send two same-object finalizations concurrently, then two different valid finalizations concurrently | Same object coalesces to one decode and returns one canonical asset; different object gets a bounded `429`, then succeeds on retry without corrupting either asset |
| H | Cancel during a large upload, then retry; separately disconnect during finalize and retry | Cancel reacts visibly, no cancelled asset publishes, and retry finishes without duplicate ready assets |
| I | 60.1+ s MP4 and a >100 MiB MP4 | Rejected before publication; no ready media descriptor or post is created |
| J | QuickTime/MOV renamed `.mp4`, fragmented MP4, and WebM/MOV picker inputs | Picker or server rejects each; renaming never bypasses the ISO MP4 contract |
| K | Interlaced H.264, HEVC/AV1/VP9, non-AAC audio, >60 fps, extra/unknown track, and pathological cropped/high-coded-resolution sample workload | Every source fails closed with a bounded 4xx response; no authoritative poster/ready asset remains |
| L | Truncated/corrupt MP4, a source changed after ticket generation, and deliberately mismatched duration/dimensions/rotation through the staging API harness | Rejects with conflict/unsupported semantics; exact object generation and declared identity cannot be swapped |
| M | Stop the verifier while staging remains flagged on; then restart it | Within one health-poll interval, negotiated capability becomes `videos:false` and new creates/finalizes fail closed; after healthy restart it returns only after a fresh signed health success |

For terminally rejected uploads, verify immediate deletion is queued. A user-cancelled, resumable draft must either be explicitly deleted after the transfer stops or be proven eligible for the seven-day orphan sweep; stopping an upload is not evidence that a public source object vanished immediately.

### Performance and stability gate

Do not promote unless all of the following are true:

- 100% of expected-accept cases accept and 100% of expected-reject cases reject, with no incorrect poster, rotation, duplicate publish, or cross-account/object result.
- At least 20 sequential real valid finalizations complete: p95 authoritative finalize time is at most 40 seconds and every worker job finishes before its 50-second service timeout (the web controller stops at 55 seconds).
- The 95–100 MiB upload finishes on each tested client/network within the client's 10-minute ceiling; progress is monotonic and cancellation becomes visible within 2 seconds.
- For 30 uninterrupted minutes after the matrix, authenticated health remains `ready=true`, `ageMs<=90000`, and has no `lastErrorCode`; the worker has no OOM, crash, unexpected restart, temp-file residue growth, or unsigned/sensitive log output.
- The deliberate outage turns negotiated publishing off within 30 seconds of the first failed scheduled check and recovery takes no more than 60 seconds after the verifier is listening. Unversioned health never advertises video.
- The single-slot busy test returns a controlled `429`; it does not exceed the 50-second job bound, burn permits for coalesced/busy work, or leave a source/variant marked ready without authoritative provenance.

Any failed bullet blocks production. Increase verifier resources or narrow the admitted video envelope if worst-case `D` cannot stay under 50 seconds; do not raise timeouts as the first response.

## Production enable sequence

This is a two-deployment rollout. The infrastructure deployment must not enable video publishing.

1. Confirm the private source bucket exists, has no public development URL or custom domain, and is distinct from `MEDIA_BUCKET`. Configure the production web service with `MEDIA_SOURCE_BUCKET` and an R2 credential scoped only to the public derivative bucket and private source bucket. Keep the previous production R2 token active during this migration; do not revoke it yet.
2. Deploy the Blueprint changes with `PIT_VIDEO_PUBLISHING_ENABLED=false`. This creates `pit-video-verifier`, generates its HMAC secret, and wires the verifier hostport/secret and source/output identifiers through `fromService`. Confirm that no R2/S3 or database credential appears on the private service.
3. With the flag still false, require at least five consecutive minutes of fresh authenticated `GET /api/admin/health` results: `services.mediaObjectStorageConfigured=true`, `services.privateVideoSourceStorageConfigured=true`, `services.privateMediaIsolation.ready=true`, `services.videoVerifier.configured=true`, `services.videoVerifier.ready=true`, pipeline exactly `private-derivative-v1`, no `lastErrorCode`, a nonempty `ffmpegVersion`, and `ageMs<=90000`. Require `GET /api/health?mediaPipeline=private-derivative-v1` to advertise `photos:true,videos:false`; the unversioned route must also advertise `videos:false`.
4. Run a real verified-account **photo** upload/publish/reload canary against production. This proves that the newly installed R2 credential can use the existing public bucket and the new private-source configuration has not broken photo publishing. Any storage/authentication error blocks video enablement.
5. In a second reviewed change, set the Blueprint value `PIT_VIDEO_PUBLISHING_ENABLED=true` and deploy. Do not use a dashboard-only override that the next Blueprint sync will silently reset.
6. Immediately require `GET /api/health?mediaPipeline=private-derivative-v1` to return `{photos:true,videos:true,pipeline:"private-derivative-v1"}` while unversioned `GET /api/health` continues to return `videos:false`. Then run one small, known-valid MP4 through the real verified-account upload, finalize, post, reload, poster, playback-to-end, and delete/cleanup path.
7. Observe authenticated health, web errors, verifier resource use, and object cleanup for 30 minutes. If the canary or observation fails, set the Blueprint flag back to `false`, deploy, and follow rollback immediately.
8. Only after both the photo and video canaries pass on the new credential, the 30-minute observation has no storage authentication errors, and live health remains fresh may the previous R2 token be revoked in Cloudflare. After revocation, repeat health plus a small photo/video canary to prove there was no hidden dependency on the old token. Never expose either token in logs, screenshots, commits, or tickets.

Do not call the feature released merely because the private service built or the flag deployment completed. The live negotiated response and end-to-end canary are the release evidence.

## Monitoring

Use authenticated `GET /api/admin/health`; never expose its response publicly. Watch:

- `capabilities.mediaPublishing` for the actual server-side gate;
- `services.mediaObjectStorageConfigured`;
- `services.videoVerifier.configured`, `ready`, `pipeline`, `lastAttemptAt`, `lastSuccessAt`, `ageMs`, `lastErrorCode`, and `ffmpegVersion`;
- web counts for media create/finalize `409`, `415`, `429`, and `503`; and
- verifier CPU/memory, restarts, job duration, temp-disk growth, and signed health failures.

The web scheduler checks every 30 seconds and considers health stale after 90 seconds. A new failed check makes readiness false immediately. A controlled `429` is expected when two different objects contend for the one decoder slot; sustained `429`s mean capacity is insufficient. Current application demand limits are 10 video creates/user/day, 20/IP/day, 200/global/day, and 12 verifications/user/hour, 24/IP/hour, 60/global/hour.

Logs may contain only coarse result codes/timings. Never log HMAC headers, request bodies, presigned source URLs, `If-Match` values, object capabilities, secrets, or poster bytes.

## Rollback

1. Set production `PIT_VIDEO_PUBLISHING_ENABLED=false` and use Render **Save and deploy**. For an active security/decoder incident, also stop the private verifier so the next signed health attempt fails closed while the web deploy rolls over.
2. Confirm `GET /api/health?mediaPipeline=private-derivative-v1` and unversioned `GET /api/health` both advertise `videos:false` on the live service. Confirm direct create/finalize attempts fail closed while photo publishing and existing clip playback still work.
3. Leave media rows and objects intact for investigation and normal cleanup. Do not reset the database, delete the bucket, or remove historical clips as part of feature rollback.
4. Rotate `PIT_VIDEO_VERIFIER_SECRET` on both services with publishing off if authentication or log exposure is suspected. Re-run the entire staging matrix before re-enabling.
5. Roll back application code only after reviewing additive database migrations and client negotiation compatibility; the feature flag is the first-line rollback.

## Private-ingest retention boundary

Original uploads remain private and are exposed only to the owner and verifier through short-lived, generation-bound signed GETs. Public feeds receive only the verifier-generated H.264/AAC derivative and JPEG poster. The derivative strips container metadata, normalizes rotation/pixels/audio, is independently decoded, and is hash-verified before publication.

Private originals remain subject to the same durable deletion ledger, terminal-rejection cleanup, orphan sweep, moderation removal, post deletion, and account-erasure prefix sweep as public variants. Bucket lifecycle policy may provide an additional retention ceiling, but it must not replace application deletion evidence.
