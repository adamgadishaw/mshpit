# PIT Media Studio

Date: 2026-08-20
Status: implemented release candidate for post photos and durable covers/fallbacks for existing clips. New clip selection and upload are now explicitly disabled unless the server advertises an authoritative publishing capability. The stable video pipeline remains schema-backed and fail-closed; new stable clip publication, destructive video editing, and venue-review Studio media require the isolated decoder/transcoder described below.

## Product decision

PIT Studio is a focused workspace opened from the composer, not another dense row of controls inside it. The workflow is:

1. Select up to eight photos or clips.
2. Edit one asset in a full-screen workspace.
3. Move between assets and arrange their order.
4. Review cover, crop, accessibility text and surface previews.
5. Render real output, upload, verify, and publish only ready assets.
6. Preserve native selections, recipes, stable identities and completed items when rendering, upload, verification, or publishing fails; reconcile the exact remote stage by idempotent server state on retry.

This follows the progressive-disclosure pattern used by Instagram, TikTok and Snapchat while preserving PIT's concert-first identity. Meta separates quick Instagram creation from the deeper Edits project workspace; TikTok and Snapchat reveal timeline tools in context rather than placing every control on the publishing screen.

Research sources:

- [Meta Edits](https://about.fb.com/news/2025/04/introducing-edits-streamlined-video-creation-app/)
- [Instagram creation updates](https://about.fb.com/news/2023/11/new-ways-to-create-content-on-instagram/)
- [Instagram Reel trim and cover](https://www.facebook.com/help/instagram/225190788256708)
- [TikTok editing](https://support.tiktok.com/en/using-tiktok/creating-videos/editing-tiktok-videos-and-photos)
- [Snapchat Timeline Editor](https://help.snapchat.com/hc/en-us/articles/41614255962132-How-do-I-edit-videos-with-Timeline-Editor)
- [CapCut project recovery](https://www.capcut.com/help/modify-history-task)

## Why clips were black

PIT previously stored only media URL strings. Feed grids deliberately replaced video with a dark `CLIP` tile, inactive reel pages had no poster, and player readiness was treated as equivalent to a painted first frame. The HTML media model also uses a black/transparent presentation while no representative frame or poster is available. A clip therefore needs an explicit poster; the video decoder is not a thumbnail service.

PIT's target loading sequence is:

`branded placeholder -> durable poster -> first painted video frame`

The poster remains visible on slow networks, blocked autoplay, and decoder failure. Retry never removes the last good poster.

Specification reference: [WHATWG video poster behavior](https://html.spec.whatwg.org/multipage/media.html).

## Version-one editing scope

### Photos

- Original, square, 4:5 portrait, 9:16 story/clip, and 16:9 landscape crops
- Zoom and normalized focal point
- Rotate and horizontal flip
- Brightness, contrast, saturation, warmth, tint, highlights, shadows, fade, vignette, grain, sharpen
- PIT, Encore, Neon, Midnight, Analog, and Mono concert presets with intensity
- Per-asset alt text
- Before/after, reset, undo and redo
- Bounded output, with real exported bytes rather than display-only CSS

### Video

- Durable default poster selected away from frame zero
- Author-selected cover time
- Poster shown in feed, profile, Clips and viewer until the first video frame is painted
- Automatic covers sample bounded points across the clip and reject black, flat-grey, or blown-white results instead of accepting the least-bad frame
- Legacy poster extraction uses a shared two-job scheduler so large profile and artist pages cannot create an unbounded decoder fan-out
- Bounded, declared duration/orientation/dimensions, structurally cross-checked before any future decoder promotion
- Non-destructive recipe fields for future trim, crop, audio and color work
- Destructive controls remain unavailable unless an authoritative renderer can export and verify new bytes

This is deliberately not marketed as full Instagram/Reels video editing yet. Trim, mute, video color, captions burned into output, transitions and a multitrack timeline require the authoritative H.264/AAC renderer described below. Until it exists, the composer requests photos only and explains that new clip publishing is being prepared while existing clips remain viewable. The server capability defaults off unless `PIT_VIDEO_PUBLISHING_ENABLED` is deliberately enabled after the renderer is deployed. A structurally plausible MP4 is never treated as playable proof.

The current SDK can generate native thumbnails, but not encode edited video. `expo-video` is used for playback and iOS/Android thumbnails; `expo-image-manipulator` handles geometric image output; Skia/Canvas handle responsive photo color preview/output. The deprecated `expo-video-thumbnails` package is deliberately not used.

SDK references:

- [Expo Video 56](https://docs.expo.dev/versions/v56.0.0/sdk/video/)
- [Expo Image Picker 56](https://docs.expo.dev/versions/v56.0.0/sdk/imagepicker/)
- [Expo Image Manipulator 56](https://docs.expo.dev/versions/v56.0.0/sdk/imagemanipulator/)
- [Expo Skia 56](https://docs.expo.dev/versions/v56.0.0/sdk/skia/)
- [Skia video limitations](https://shopify.github.io/react-native-skia/docs/video/)

## Durable model

Legacy posts keep their `photos` URL array during migration. New media uses stable identities:

- `media_assets`: owner, create-only source identity, type, byte count, dimensions, duration, orientation, status, recipe/version, metadata and render state.
- `media_variants`: poster and rendered display outputs with exact storage identity and dimensions.
- `post_media`: ordered post-to-asset relationship.
- Client `mediaProject`: at most eight normalized assets, progress/error state, edit recipe and alt text.

The source, poster, and render URLs are assigned by PIT. Clients never submit arbitrary object keys or claim that an external URL belongs to an asset. Object keys contain an unprojected random capability and signed PUTs require `If-None-Match: *`, so an expired/replayed client cannot overwrite a finalized key. A lost-response retry may receive storage status 412 and then reconciles through finalize. The R2 bucket CORS policy must allow `If-None-Match` before release.

Finalize performs storage verification before an asset can become ready. Size and MIME are authoritative only to the storage headers; images become public solely through a decoded, bounded JPEG/PNG/WebP rendition, including the visual `Original` setting. The original is returned only to its owner in authenticated PIT projections. Video receives a bounded structural MP4/H.264/AAC preflight, but that parser cannot prove complete decoder success. Production therefore keeps new stable video `render_unavailable` with no public URL; only a future server-owned decoder/transcoder may promote it.

A public post projects only its display URL and safe metadata. Owners may receive the immutable source reference for editing/recovery. Likes, reports and moderation can migrate to the stable asset identity instead of an attachment index that changes when assets are reordered.

## Processing state

The client state machine is:

`selected -> editing -> rendering -> uploading -> finalizing -> ready`

Any active stage may enter `failed`. A retry resumes the failed stage using the same client asset/variant token; it does not create another logical post or media item.

Photo recipe replacement is transactional. Changing an uploaded but unpublished photo keeps its last verified rendition active while a new recipe and variant are staged. Failed upload, cancellation, or verification leaves the previous public URL intact. Only successful variant finalization atomically promotes the staged recipe, swaps the pointer, and queues the old object for deletion. A pending revision cannot be attached to a post.

On iOS and Android, selected originals are copied into an account/project-scoped PIT directory under the app's document sandbox before Studio opens. Draft serialization admits only those proven `pit-studio` file URIs, recipes and metadata; deletion refuses paths outside the actual Expo `Paths.document` root. This survives activity recreation and ordinary process death. It is cleaned after verified upload, explicit discard, draft deletion or account deletion. Browser-selected `File` objects remain session-only, so web keeps an unload/close guard instead of promising recovery that the web file-permission model cannot provide.

Publish readiness requires:

- a verified stable asset ID;
- a verified public display/source variant;
- a durable poster for every video;
- a ready render state;
- no failed attachment.

For video, structural preflight is necessary but not sufficient. The current production service deliberately has no promotion path, so a new stable clip cannot satisfy readiness until the authoritative worker exists. Tests inject a decoder result only to exercise the future state transition. The public capability flag controls whether the composer offers video; it does not itself provide a decoder or make an asset publishable.

The UI must never convert `render pending`, `render unavailable`, or `verification pending` into a successful post.

## Safe pipeline

1. The system picker grants only selected media.
2. PIT validates client-visible size/type/duration constraints before native durable staging and remeasures the copied file.
3. Editing uses a bounded proxy and a versioned non-destructive recipe.
4. The source receives an owner-bound, unprojected, create-only upload identity.
5. PIT verifies storage headers and required derivative state; it does not call a header check or MP4 box parser a malware, image-safety, or full decode scan.
6. The photo renderer or future video worker produces a derivative.
7. Poster/render variants are verified separately.
8. Safety scanning/quarantine must approve public derivatives before a broad App Store launch.
9. Account, post, and moderation removal enqueue every owned object and variant through PIT's deletion lifecycle.

The current direct-storage architecture is being migrated without breaking existing posts. Fresh post media cannot enter through arbitrary URL arrays; historical rows are grandfathered only when unchanged. Legacy posts must remove all old URL-only attachments before adding stable Studio media. Venue reviews remain on a separate legacy, photo-only path and do not receive Studio's derivative guarantees yet. Dedicated uploaded-image/video safety scanning remains an App Store launch gate and is not falsely represented as complete here.

## Video renderer boundary

Device preview and authoritative output are separate responsibilities. PIT will not ship a fake trim that changes only playback metadata, or an MP4 edit-list trim that leaves supposedly removed frames recoverable in the file.

The production renderer should emit:

- MP4 container;
- H.264 video and AAC-LC audio;
- rotation baked into pixels;
- square pixels;
- fast-start metadata;
- bounded 1080p output for normal posts;
- explicit HDR-to-SDR handling when required;
- frame-accurate trim within the supported codec/timebase envelope.

An embedded mobile FFmpeg wrapper is not on the critical path. It adds large binaries, licensing and supply-chain risk, has no equivalent browser implementation, and would still require a server fallback. PIT Studio supplies the recipe and preview; a managed/server worker supplies authoritative cross-platform video output.

The selected production architecture is an isolated Render Docker background worker, not FFmpeg inside the Starter web/SQLite process. The control plane keeps a durable, idempotent job in SQLite and exposes a private authenticated lease/completion boundary. A concurrency-one worker receives exact ETag-bound R2 GET and create-only PUT capabilities, renders in an ephemeral per-job directory, fully decodes the result, generates its poster, uploads deterministic outputs, and asks the web control plane to promote them only after independent HEAD and structural verification. It has no long-lived R2 credential and cannot mutate SQLite directly.

The worker is intentionally not provisioned by this change. A production and staging worker add paid Render compute and require an owner decision, codec/legal review, pinned Docker image and FFmpeg build attestation, hostile-fixture benchmarks, staging recovery drills, and uploaded-media quarantine. The current web service remains responsive and fail-closed until those gates are met.

Infrastructure references:

- [Render background workers](https://render.com/docs/background-workers)
- [Render private networking](https://render.com/docs/private-network)
- [Render native runtime tools](https://render.com/docs/native-runtimes)
- [Cloudflare R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [FFmpeg legal guidance](https://ffmpeg.org/legal.html)

## Accessibility and trust

- Every control has a label, state and at least a 44-point target.
- Sliders expose their name and current value; Reset and Done are not gesture-only.
- Asset movement and video cover choice have button/keyboard alternatives.
- Reduce Motion disables decorative transitions; editor audio never starts unexpectedly.
- Alt text is stored per image/asset and can evolve independently of the pixel recipe.
- Video captions are a publishing requirement for the later video-render milestone, with manual correction always available.
- Raw media, filenames, local URIs, alt text and captions are never analytics properties.
- Original and edited output are never overwritten in place.
- Cover, audience, ownership, and surface-feature consent remain explicit.

Accessibility references: [WCAG 2.2](https://www.w3.org/TR/WCAG22/), [TikTok accessibility](https://support.tiktok.com/en/using-tiktok/creating-videos/accessibility), [Instagram alt text](https://www.facebook.com/help/instagram/503708446705527/).

## Release gates

### Automated

- Recipe normalization, range bounds, crop math and deterministic fingerprints
- Twenty-step undo/redo and reset behavior
- Web/native photo-render output and cancellation
- Poster generation at nonzero author/default cover times
- Automatic poster quality rejection and bounded cross-surface extraction concurrency
- Transactional photo recipe replacement with old-rendition survival through failure and cancellation
- Source/variant ticket idempotency and storage verification
- Hostile keys/URLs/MIME/size/dimension/duration rejection
- Post mutation retry, create-only PUT reconciliation and grandfather-only legacy compatibility
- Deletion of source, poster and render variants
- No post becomes ready without the required poster/variant and, for video, a server-owned decoder promotion
- No feed grid mounts an unbounded set of video decoders
- Native draft persistence admits only PIT-managed app files and account deletion removes the owner staging directory

### Device/browser

- iOS JPEG, HEIC, PNG, H.264 MP4 and rotated captures; explicitly verify rejection of unsupported animation/codec paths
- Android content-provider URIs, activity recreation, H.264 MP4 plus HEVC/AV1 rejection, API baseline and Samsung/Pixel fixtures
- Chrome, Edge, Firefox and Safari with JPEG/PNG/WebP/H.264 MP4 plus HEIC/GIF/HEVC/WebM/MOV rejection copy
- 4K and 100 MB clips, low-memory/background/interruption, poor network and storage exhaustion
- VoiceOver/TalkBack, keyboard, visible focus, large text, contrast and Reduce Motion

### Quality targets

- New ready video poster coverage: 100%
- Duplicate posts from media retry: 0
- Draft loss in automated interruption tests: 0
- Render success on supported fixtures: at least 99%
- Photo preview/output golden similarity: SSIM at least 0.98 for fixed fixtures
- Normal 1080p editor interactive time: p95 under two seconds on the supported device baseline
- Adjustment feedback target: under 100 ms

### Operational and native distribution blockers

- Configure R2 CORS `AllowedHeaders` for `Content-Type` and `If-None-Match`, then prove first PUT, lost-response 412 retry, finalize, deletion and CORS preflight in staging.
- Provision and benchmark the isolated authoritative decoder/transcoder worker before setting `PIT_VIDEO_PUBLISHING_ENABLED=true`. The current structural MP4 gate and capability flag cannot promote production video by themselves.
- Complete GPL/x264 and H.264/AAC patent review, pin/attest the Docker image and FFmpeg build, and define its SBOM/CVE update process before external distribution.
- Keep external App Store distribution blocked until uploaded image/video safety quarantine/scanning is deployed and verified.
- Expo Doctor currently reports the known Hermes V1 memory regression in Expo 56 / React Native 0.85. A production native release needs the upstream fixed runtime (planned SDK 57 migration) or an explicit, measured risk decision; PIT Studio and Clips are memory-sensitive surfaces.
- Physical iPhone and representative Android acceptance remains mandatory. JS export and unit tests do not prove decoder, picker, Skia, keyboard, memory-pressure or process-death behavior on devices.
- Provider/catalog media rights, off-host backup retention and App Store operational/legal gates remain tracked in `APP_STORE_READINESS.md`; this media implementation does not supersede them.

## Roadmap

1. Durable posters and stable media identity.
2. Reliable photo Studio with crop, color, filters, accessibility and recovery.
3. Authoritative single-clip video export: trim, crop, audio level, color and captions.
4. Multi-clip timeline: split, reorder, duplicate, transitions, waveform and timed layers.
5. Licensed music, templates, collaboration and advanced color.
6. Provenance-aware AI editing only after consent, disclosure, moderation and rights controls exist.

Stages 1-3 are an Instagram-style posting editor. PIT should not market them as a CapCut-class multitrack suite until stage 4 is built, measured, and recoverable.
