# Going sharing and upload alert investigation

## What the alert establishes

The supplied digest contains the previously documented browser crash request
`5109467a-5745-47b2-a3cb-cd4518321a6f` and one upload-preparation rejection:
`POST /api/media/assets`, HTTP 503, `MEDIA_STORAGE_UNAVAILABLE`, request
`c271bd7f-8637-4fd4-8a8e-e087ed9447b4`.

The older UUID appears in `docs/you-page-crash-2026-09-08.md`. The alert's
**Initial catch-up** label applies to the entire delivery batch, not individually
to each row. A batch may contain retained older failures and newly recorded ones;
failed or uncertain email delivery also preserves its frozen batch for retry.
The screenshot therefore does not prove another browser crash, traffic overload,
or the upload failure's exact occurrence time. Existing alert-delivery regressions
passed (34 tests); successful acknowledgement prevents later replay.

The upload route prepares an owned asset/upload capability. Pixel upload and
decoding happen later. Its 503 can represent incomplete/invalid configuration,
an unready private-storage privacy proof, or a service-wide upload-capacity limit.
It does not identify a Sharp decoding problem. Sharing an existing Going card uses
`POST /api/share-cards/render`, a separate endpoint; the email does not establish
that the two failures share a cause.

A single public read-only health check at **2026-09-08 20:40:30 EDT**
(`2026-09-09T00:40:30.807Z`) returned HTTP 200 with `photos: true`, request
`36171119-3702-4ae7-ba74-462e101dee2b`. This is a point-in-time capability check,
not a successful upload test or a check of the global quota. The unnegotiated
health response does not establish video readiness. Browser control failed
before it could read Render on two attempts; historical server logs remain
unavailable. No credentials were read and no production data was mutated.

## Local repairs

- Recover the Going post composer when its publishing callback rejects; prevent
  duplicate presses and preserve retry identity and same-account draft content.
- Give share-card preparation an independent deadline, a recoverable error state
  and explicit retry; closing or changing account/item must discard late results.
  Preparing an image is bounded, but a user's time in an external share sheet is
  not treated as a failed network request.
- Preserve the existing card design, photo eligibility rules and original-file
  privacy checks. No arbitrary provider imagery or private media is substituted.
- Isolate native share cache files per preparation. Concurrent/retried cards no
  longer overwrite one another; cleanup only removes a file that the attempt
  created. Recheck cancellation after the image response so an abandoned attempt
  cannot write a late file. Friendly filenames in the share sheet are unchanged.
- Classify future upload-preparation errors privately as
  `MediaStorageFailure/configuration_invalid`, `MediaStorageFailure/privacy_not_ready`
  or `MediaStorageFailure/service_capacity`. The public 503/code/retry contract
  remains unchanged. Only fixed reason strings enter telemetry, never storage
  credentials, bucket names, object URLs or member details.

Expo's networking and cancellation guidance informed the preparation lifecycle
checks; the project remains on its existing SDK 57 version.

## Verification

`npm run check` passed with **3,790/3,790 tests**, zero reported production
dependency vulnerabilities, syntax/architecture checks and the production web
export. The final bundle is `index-fe48fedb5e01ec417cf84b569badef7c.js`;
initial JavaScript is 493.0 KiB gzip against the 512.0 KiB budget.

Initial focused checks: 42 upload/privacy/diagnostic tests and 53 server
share-rendering/authorization tests passed. A follow-up
configuration-versus-privacy regression batch passed 7/7. Five native
cache tests execute the actual adapter with an in-memory SDK filesystem, not a
physical iOS/Android device. The client preparation/UI batch passed 22/22 and the
Going composer/attendance batch passed 50/50 using controlled component hooks.

Final mobile-browser verification passed all six checks on the exact final
export above at 390 px with touch enabled. The actual exported app opened its
saved Going share dialog; a deliberately non-aborting image request left loading
after 15,124 ms, manual Retry started one new request and displayed its prepared
PNG, and the late first response could not replace that image. Both requests
carried the expected account and exact event/intent. Closing released both Blob
URLs, including the obsolete response. There were zero page, console or routing
errors and no fatal crash receipts.

This browser check used loopback hosting and intercepted synthetic API responses;
it did not exercise production storage or an Instagram/X/Facebook handoff. The
first harness attempt used an invalid fixture Show ID and stopped before sharing;
correcting the scratch fixture to the existing canonical schema allowed the final
run to pass without changing product code. Harness:
`.tmp/going-share-browser.mjs` (ignored local test artifact).

## Release and remaining evidence

Changes are local, alongside the earlier security/artist-lookup work. Nothing was
committed, pushed or deployed in this investigation. No live post, RSVP, photo,
Instagram Story or other social share was created.

The historical upload 503 is **not diagnosed as resolved**. To establish its cause,
correlate the supplied request UUID's Render timestamp with private-storage probe
logs and authenticated moderation health/capacity state. Do not relax the privacy
gate or raise storage limits merely to suppress the alert.
