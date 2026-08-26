# Legacy media recovery runbook

This rollout restores historical URL-only post/profile photos without making old raw camera objects public again. A photo becomes visible only after PIT proves the object belongs to the account, binds the exact ETag generation, decodes it in the isolated image worker, strips metadata, writes a fixed sanitized rendition, and atomically replaces/attaches the verified reference.

## Automatic rollout

- Render sets `MEDIA_LEGACY_RECOVERY_ENABLED=true` on production and staging.
- The web process does **not** start recovery until the live private-bucket isolation probe reports ready. A failed or unavailable proof leaves historical raw URLs hidden.
- Work is serial and bounded to two items per turn. A remaining healthy backlog continues after a one-second yield; idle or retry-deferred work waits five minutes. Per-object exponential backoff prevents one corrupt file from blocking others.
- Shutdown aborts the active transfer/processor signal and waits for the bounded turn before closing SQLite.
- Set `MEDIA_LEGACY_RECOVERY_ENABLED=false` for an immediate rollout pause. This does not delete media or undo already verified renditions.

## Verify after deploy

1. Open the authenticated staff health response (`GET /api/admin/health`).
2. Confirm `services.privateMediaIsolation.ready` is true.
3. Confirm `services.backgroundJobs.legacyImageRecoveryEnabled` and `services.legacyImageRecovery.enabled` are true.
4. Watch aggregate `scanned`, `recovered`, `failed`, `exhausted`, `lastSuccessAt`, and `lastErrorCode`. These fields contain no object keys, URLs, bucket names, or member data.
5. Check a known historical post/profile. Its sanitized URL should reappear; the raw legacy URL must remain absent from API responses.

## Manual bounded fallback

If the web scheduler is paused for an incident, an operator can run `npm run recover:legacy-images -- --max-items=32` from the production service shell after private isolation is healthy. The command is idempotent and retains the same ownership, ETag, decode, metadata-strip, and atomic compare-and-swap checks. Repeat only while its output reports remaining work. Never copy legacy URLs into API responses or mark objects verified manually.