# Reliability deep review — September 19, 2026

## Production evidence before this release

The live web release inspected was `037197dd6605603baaeb8b9ffd049a63ddaf55db`, deployed September 16. The following observations are aggregates; member identities, search terms, IP addresses, credentials and private media URLs are intentionally omitted.

- September 17–18 request logs included two artist-resolution 502s: one approximately 21.3-second provider timeout and one network failure. They are failed HTTP requests, not proof that the whole application crashed or that a particular member made them.
- Fifteen other fast crawler-facing 502s occurred on event/city pages. No matching application error established their cause. They must not all be attributed to MusicBrainz.
- The same period included background memory deferrals and isolated multi-second response-time spikes. September 19's sampled CPU/memory did not show sustained resource saturation. Persistent storage reported roughly 77% free on September 18, with a healthy read probe. Disk exhaustion was not demonstrated.
- Observed media API requests in the inspected window returned HTTP 200, but some video verification polling lasted approximately 100 seconds. HTTP success alone does not establish that every asynchronous media job succeeded. An iPhone picker can also hang before any upload request reaches the server.
- The latest request-error query, September 18 22:40 UTC through the September 19 review, returned no error entries; application logs still contained two background memory deferrals. This limited window is not a guarantee of future availability.

## Confirmed causes and repairs

### Artist lookups

An abort signal alone did not guarantee timely completion when a provider adapter ignored cancellation. The lookup coordinator now settles callers at its deadline while retaining the physical concurrency reservation until the underlying work unwinds. Late answers cannot enter the cache.

Existing catalogue and exact cached answers remain first. A slow uncached preview starts one independently bounded exact-name Deezer fallback after 1.5 seconds. A fast MusicBrainz answer makes no extra provider request. A fallback is a preview, not authority to merge identities or attach an artist. Namesake/ambiguous matches remain rejected. Both-provider failure remains an honest retryable error rather than a fabricated artist or false not-found answer.

Shared MusicBrainz throttling also respects absolute retry deadlines. Its documented 503 responses can reflect application/IP rate limiting or global load; the logs do not establish a provider-wide incident. See [MusicBrainz rate limiting](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting).

### Idle maintenance and request stalls

An empty demand-refresh queue returns SQL `NULL` from `MIN(due_at)`. Converting it to zero scheduled another wake approximately every 550 milliseconds. Empty queues now stop their timer; fresh demand reactivates them. This removes wasted admission churn without increasing provider request rates.

A read-only local profile measured synchronous sitemap construction at approximately 0.6–1.4 seconds for a much smaller catalogue than production. Sitemap construction now runs in a short-lived child process, not on the request event loop. The child has a read-only SQLite connection, a consistent transaction, an 8 MiB SQLite cache, a 384 MiB JavaScript heap ceiling, a 60-second deadline and a 96 MiB cumulative output ceiling. The heap ceiling is not a total RSS limit. Memory admission reserves 576 MiB of estimated headroom and waits for actual process closure before releasing it.

Only validated public URL settings and a small OS environment allowlist enter the child; provider/storage credentials do not. Runtime licensed venue photos and eligible member media retain the same sitemap projection and revocation rules. The last good snapshot remains available when a refresh fails or yields to an upload. No database migration, new paid worker or additional service is required.

### iPhone/web media selection and retries

The installed Expo web picker decoded every selected image/video before returning, using parallel metadata promises without a deadline. One missing browser metadata event could hold the entire picker open indefinitely. The composer now receives bounded File handles directly inside the user gesture, without eager decoding. A cancellation control handles browsers that do not report dialog cancellation.

Pending thumbnails do not decode an entire album. Sequential uploads retain their existing private-source and verification pipeline. Completed files release transient File/object-URL references; unfinished files remain available for retry. Completed items and review text survive cancellation, and verification retries do not repeat successful source PUTs.

Missing iCloud MIME/filename information no longer proves that a file is a photo. Genuinely unclassified files may reach bounded byte sniffing; the actual photo/video size limit is enforced before creating or uploading a source. The detected kind survives cancellation and retry and determines the correct original recipe/poster requirements.

Verification is not just throttling: compressed file size does not establish decoder safety, valid structure, supported encoding, playback compatibility, or privacy-safe public derivatives. Existing limits and private-source checks remain intact. Real iPhone/iCloud selection and the originally failing clips cannot be certified without a device/sample.

The video audit also found an output-budget mismatch: the fixed 11 Mbps video plus 160 kbps audio ceiling could exceed the 500 MiB delivery limit on an otherwise accepted ten-minute clip. Transcodes now use a duration-aware bitrate ceiling with audio, encoder-buffer and container headroom. Short clips retain the existing quality ceiling; long clips are not truncated. The final byte-size and full-decode checks remain authoritative. This correction requires the private verifier service to deploy the same release as the web app.

Remaining media findings are deliberately distinguished from repaired bugs:

- There is one active verification slot, with exact-job coalescing but no fair waiting queue. A different simultaneous job can receive 429 and require manual Retry; its uploaded original is retained. A future bounded queue should distinguish processing contention from account quotas rather than automatically replaying all 429 responses.
- Reviewed H.264, HEVC Main/Main10 and QuickTime forms are supported. Unsupported codecs, Dolby Vision tags and malformed streams remain rejected. HDR tone-mapping has no explicit quality coverage. Those are compatibility boundaries, not proof of the original incident's cause.
- Rotation, HEVC, 4K and portrait 1080x1920 take the slower transcode path. Ten minutes and 500 MiB are not the only limits: dimensions, frame rate and cumulative decoded work are bounded too. Blueprint configuration also specifies per-account original-upload byte/ticket budgets.
- Synthetic long-video tests validate bitrate arithmetic and pipeline arguments, not an actual ten-minute encode. Browser fixtures validate application behavior with mocked authoritative verification, not physical iPhone Photos or every codec.

### Discover venues and navigation

Venues now starts with a city, a searchable list and direct venue links. Changing city, upcoming-show expansion and the map are optional disclosures. The map is not loaded by default. Reviewed venue aliases stay deduplicated; distinct rooms remain separate, and original event links remain intact.

Browser testing found two additional navigation failures: opening a venue and returning to Discover forgot the Venues tab, and a stale navigation effect could rewrite the popped URL back to the departed venue. The destination is now remembered within the current viewer scope; stale render frames cannot overwrite newer navigation intent. Tests check both visible content and browser address.

## Release gates and deliberate limits

Local verification completed: `npm run check` passed all 5,198 tests, syntax and architecture gates, a clean production dependency audit, and the 511.6/512 KiB initial-JavaScript budget. All seven exported-app browser suites passed (125 scenarios). The earlier Render-like configuration run passed 5,193 tests before the final five verifier cases were added; the verifier/parser/coordinator suite then passed 284 tests. Public read-only baseline checks passed for core APIs, media readiness and a bounded 20-request SEO sample. These local/baseline results do not assert that a new release is already live.

Run the entire isolated test suite, syntax/architecture/dependency checks, production web bundle budget and exported-app browser regressions before committing. CI includes the new mixed-media cancellation/retry scenario. After pushing, verify the live Render commit, public core/media/SEO checks and the first maintenance refresh; a local passing test is not deployment evidence.

This work does not configure the still-unverified private off-host backup destination, purchase capacity, claim all historical crawler errors are solved, or promise Google indexing. It also does not multiply catalogue provider calls: more simultaneous agents would not bypass upstream rate limits safely.
