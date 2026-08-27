import assert from "node:assert/strict";
import test from "node:test";

import {
  activeYouTubeLookupStatus,
  classifyResolve,
  CACHE_MS,
  playerColdSearchAllowed,
  playerLookupIntent,
  requestYouTubeTrackOnce,
  shouldUseYouTubeLookupCache,
} from "./playback.mjs";
import { playerYouTubeLookupNotice, playerYouTubeStatusMessage } from "./playerYouTubeNotice.mjs";
import { shouldResolvePlayerYouTube } from "./playerSourceResolution.mjs";

test("a resolved video is trusted and cached for a long time", () => {
  const r = classifyResolve({ videoId: "abc123", status: "artist_catalogue" });
  assert.equal(r.videoId, "abc123");
  assert.equal(r.retry, false);
  assert.equal(r.cacheMs, CACHE_MS.hit);
});

test("capacity failures stay temporary without amplifying one play into retries", () => {
  // These are the statuses that made popular songs play as previews: the song
  // was fine, we just could not ask at that moment.
  for (const status of [
    "search_budget_exhausted",
    "provider_paused",
    "recording_proof_unavailable",
    "quota_or_forbidden",
    "rate_limited",
    "resolution_timeout",
  ]) {
    const r = classifyResolve({ videoId: null, status, retryable: true });
    assert.equal(r.transient, true, `${status} should be temporary`);
    assert.equal(r.retry, false, `${status} must require another explicit listener action`);
    assert.equal(r.cacheMs, CACHE_MS.transient, `${status} must not be cached as a lasting answer`);
  }
});

test("a real 'no video exists' answer is respected and not retried forever", () => {
  for (const status of [
    "confirmed_unavailable",
    "not_found",
    "unconfigured",
    "search_login_required",
    "search_verification_required",
    "search_actor_budget_exhausted",
  ]) {
    const r = classifyResolve({ videoId: null, status });
    assert.equal(r.transient, false, `${status} is a real answer`);
    assert.equal(r.retry, false);
    assert.equal(r.cacheMs, CACHE_MS.definitive);
  }
});

test("an explicit non-retryable API result is authoritative even for a new status", () => {
  const result = classifyResolve({ videoId: null, status: "future_access_boundary", retryable: false });
  assert.deepEqual(result, {
    videoId: null,
    transient: false,
    retry: false,
    cacheMs: CACHE_MS.definitive,
    status: "future_access_boundary",
  });
});

test("a failed request expires quickly but is not automatically retried", () => {
  for (const error of [{ status: 429 }, { status: 500 }, { status: 503 }, { status: 408 }, new Error("network down")]) {
    const r = classifyResolve({ error });
    assert.equal(r.retry, false, `${error.status || "network"} must not amplify the selected play`);
    assert.equal(r.transient, true);
    assert.equal(r.cacheMs, CACHE_MS.transient);
  }
});

test("a genuine client mistake is not retried in a loop", () => {
  for (const error of [{ status: 400 }, { status: 404 }]) {
    const r = classifyResolve({ error });
    assert.equal(r.retry, false, `${error.status} is our bug, retrying cannot fix it`);
  }
});

test("an unrecognised status expires quickly but waits for another action", () => {
  const r = classifyResolve({ videoId: null, status: "something_new" });
  assert.equal(r.retry, false);
  assert.equal(r.transient, true);
});

test("automatic playback is catalogue-only and performs no cold-search POST", async () => {
  const calls = [];
  const result = await requestYouTubeTrackOnce({
    request: async (path, options) => {
      calls.push({ path, options });
      return { videoId: null, status: "search_deferred", retryable: false };
    },
    title: "Middle Child",
    artist: "J. Cole",
  });

  assert.equal(result.status, "search_deferred");
  assert.equal(calls.length, 1);
  assert.match(calls[0].path, /^\/api\/youtube\/track\?/);
  assert.equal(calls[0].options, undefined);
});

test("one explicit cold attempt performs exactly one POST without quota retry amplification", async () => {
  const calls = [];
  const result = await requestYouTubeTrackOnce({
    request: async (path, options) => {
      calls.push({ path, options });
      if (!options) return { videoId: null, status: "search_deferred", retryable: false };
      return { videoId: null, status: "search_budget_exhausted", retryable: true };
    },
    title: "Middle Child",
    artist: "J. Cole",
    duration: 213,
    provider: "deezer",
    sourceId: "123",
    allowSearch: true,
  });

  assert.equal(result.status, "search_budget_exhausted");
  assert.equal(calls.length, 2, "one safe GET plus one explicit cold POST");
  assert.equal(calls.filter(({ options }) => options?.method === "POST").length, 1);
  assert.equal(calls[1].path, "/api/youtube/track/resolve");
  assert.deepEqual(calls[1].options.body, {
    title: "Middle Child",
    artist: "J. Cole",
    duration: 213,
    provider: "deezer",
    sourceId: "123",
  });
  assert.equal(classifyResolve(result).retry, false);
});

test("a player cancellation signal reaches both resolver phases", async () => {
  const controller = new AbortController();
  const calls = [];
  await requestYouTubeTrackOnce({
    request: async (path, options) => {
      calls.push({ path, options });
      return options?.method === "POST"
        ? { videoId: "abcdefghijk", status: "resolved" }
        : { videoId: null, status: "search_deferred", retryable: false };
    },
    title: "Middle Child",
    artist: "J. Cole",
    allowSearch: true,
    signal: controller.signal,
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.signal, controller.signal);
  assert.equal(calls[1].options.signal, controller.signal);
});

test("an explicit action upgrades a fresh catalogue-only result instead of inheriting it", () => {
  const deferred = { videoId: null, status: "search_deferred", expiresAt: 2_000 };
  assert.equal(shouldUseYouTubeLookupCache(deferred, { allowSearch: false, now: 1_000 }), true,
    "automatic playback reuses its catalogue-only boundary");
  assert.equal(shouldUseYouTubeLookupCache(deferred, { allowSearch: true, now: 1_000 }), false,
    "Find full track may cross the cached deferred boundary once");
  assert.equal(shouldUseYouTubeLookupCache({ ...deferred, status: "search_budget_exhausted" }, { allowSearch: true, now: 1_000 }), true,
    "an explicit click cannot bypass a fresh capacity result into a retry loop");
});

test("native playback never invokes the YouTube resolver or spends search", async () => {
  let calls = 0;
  const shouldResolve = shouldResolvePlayerYouTube({
    web: false,
    minimized: false,
    directVideoId: null,
    resolvedVideoId: null,
    youtubeSettled: false,
  });
  if (shouldResolve) {
    await requestYouTubeTrackOnce({
      request: async () => { calls += 1; return { status: "search_deferred" }; },
      title: "Middle Child",
      allowSearch: true,
    });
  }
  assert.equal(shouldResolve, false);
  assert.equal(calls, 0);
});

test("lookup intent follows the exact queue occurrence through duplicates and reorders", () => {
  const first = { title: "Repeat", artist: "Artist", queueEntryId: "occurrence-1" };
  const second = { title: "Repeat", artist: "Artist", queueEntryId: "occurrence-2" };
  const explicitSecond = playerLookupIntent(second, "explicit");
  const reordered = [second, first];

  assert.equal(playerColdSearchAllowed(reordered[0], explicitSecond), true);
  assert.equal(playerColdSearchAllowed(reordered[1], explicitSecond), false, "a duplicate recording cannot inherit the other occurrence's click");
  assert.equal(playerColdSearchAllowed(second, playerLookupIntent(second, "automatic")), false);
  assert.equal(playerColdSearchAllowed(second, playerLookupIntent(second, "unknown-trigger")), false,
    "new or malformed transition reasons fail closed to catalogue-only");
});

test("missing or empty input never claims a video", () => {
  for (const outcome of [{}, { videoId: null }, { videoId: "" }, undefined]) {
    assert.equal(classifyResolve(outcome).videoId, null);
  }
});

test("access and capacity outcomes get truthful player notices", () => {
  assert.deepEqual(playerYouTubeLookupNotice("search_login_required"), {
    kind: "sign_in",
    message: "Sign in for full-track YouTube lookup.",
  });
  assert.equal(playerYouTubeLookupNotice("search_verification_required")?.kind, "verify_email");
  assert.equal(playerYouTubeLookupNotice("search_actor_budget_exhausted")?.kind, "account_limit");
  assert.equal(playerYouTubeLookupNotice("search_deferred")?.kind, "catalogue_only");
  assert.equal(playerYouTubeLookupNotice("search_budget_exhausted")?.kind, "global_limit");
  assert.equal(playerYouTubeLookupNotice("provider_paused")?.kind, "provider_unavailable");
  assert.deepEqual(playerYouTubeLookupNotice("recording_proof_unavailable"), {
    kind: "recording_verification",
    message: "PIT could not verify this exact recording for full-track playback yet.",
  });
  assert.equal(playerYouTubeLookupNotice("resolution_timeout")?.kind, "temporary");
  assert.equal(playerYouTubeLookupNotice("unconfigured")?.kind, "configuration");
});

test("preview status copy reports actual playback state", () => {
  const verification = playerYouTubeLookupNotice("search_verification_required");
  assert.equal(
    playerYouTubeStatusMessage(verification, { preview: true, previewState: "playing" }),
    "Verify your email for full-track YouTube lookup. Preview playing.",
  );
  assert.equal(
    playerYouTubeStatusMessage(verification, { preview: true }),
    "Verify your email for full-track YouTube lookup. Preview available.",
  );
  assert.equal(
    playerYouTubeStatusMessage(verification, { preview: true, previewState: "requires_gesture" }),
    "Verify your email for full-track YouTube lookup. Preview ready — press Play.",
  );
  assert.equal(
    playerYouTubeStatusMessage(playerYouTubeLookupNotice("search_deferred"), { preview: true, previewState: "playing" }),
    "Previewing without spending a YouTube search.",
  );
  assert.equal(
    playerYouTubeStatusMessage(playerYouTubeLookupNotice("recording_proof_unavailable"), { preview: true, previewState: "playing" }),
    "PIT could not verify this exact recording for full-track playback yet. Preview playing.",
    "a source-proof outage must not claim that the YouTube provider paused",
  );
});

test("real misses and successful resolver states remain ordinary playback outcomes", () => {
  for (const status of ["not_found", "confirmed_unavailable", "cached", "resolved", "artist_channel", "unknown_future_status", "", null]) {
    assert.equal(playerYouTubeLookupNotice(status), null, `${status || "empty"} must not suppress a real unavailable-track report`);
  }
});

test("only a fresh well-formed cached lookup status is exposed", () => {
  assert.equal(activeYouTubeLookupStatus({ status: " search_login_required ", expiresAt: 2000 }, 1000), "search_login_required");
  assert.equal(activeYouTubeLookupStatus({ status: "not_found", expiresAt: 1000 }, 1000), null);
  assert.equal(activeYouTubeLookupStatus({ status: "not_found", expiresAt: Number.NaN }, 1000), null);
  assert.equal(activeYouTubeLookupStatus({ status: {}, expiresAt: 2000 }, 1000), null);
  assert.equal(activeYouTubeLookupStatus(null, 1000), null);
});
