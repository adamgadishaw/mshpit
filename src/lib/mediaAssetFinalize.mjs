// The server acknowledges background verification quickly, while a ten-minute
// phone clip can take longer to normalize on a small worker. Poll for a finite
// 18-minute envelope without holding one proxy request open that whole time.
export const MEDIA_SOURCE_FINALIZE_V1_TIMEOUT_MS = 18 * 60_000;
// Current servers acknowledge detached video work; a lost acknowledgement is
// reconciled through the owner-only GET below. Do not hold the composer behind
// a proxy request for minutes before beginning that reconciliation.
export const MEDIA_SOURCE_FINALIZE_REQUEST_TIMEOUT_MS = 30_000;
// Starting or recovering a detached job is a short control-plane operation.
// The long envelope above begins only after the server explicitly reports that
// authoritative processing is underway.
export const MEDIA_SOURCE_FINALIZE_START_TIMEOUT_MS = 90_000;
// Five seconds avoids noisy polling while still giving quick completion
// feedback. Poll reads have no member-facing upload count allowance.
export const MEDIA_SOURCE_FINALIZE_POLL_INTERVAL_MS = 5_000;
const MAX_RESTART_SUBMISSIONS = 3;

function mediaSourceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function abortError(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error("Media verification was cancelled.");
  error.name = "AbortError";
  return error;
}

function waitForPoll(ms, signal) {
  if (signal?.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, ms);
    function finish() {
      signal?.removeEventListener?.("abort", cancel);
      resolve();
    }
    function cancel() {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", cancel);
      reject(abortError(signal));
    }
    signal?.addEventListener?.("abort", cancel, { once: true });
  });
}

function retryableRequestFailure(error) {
  const status = Number(error?.status);
  return !Number.isFinite(status) || status === 429 || status >= 500;
}

function processingFailure(value) {
  if (value?.finalize?.state !== "failed") return null;
  const source = value.finalize.error || {};
  const error = new Error(typeof source.message === "string" && source.message
    ? source.message
    : "PIT could not finish verifying that media.");
  error.code = typeof source.code === "string" ? source.code : "MEDIA_STORAGE_UNAVAILABLE";
  error.status = Number.isSafeInteger(Number(source.status)) ? Number(source.status) : 503;
  error.retryable = source.retryable === true;
  return error;
}

function deadlineFailure(lastError) {
  const error = new Error("PIT is still processing this clip. Your upload is saved—try again to resume it.",
    lastError ? { cause: lastError } : undefined);
  error.code = "MEDIA_STORAGE_UNAVAILABLE";
  error.status = 503;
  error.retryable = true;
  return error;
}

function startFailure(lastError) {
  const error = new Error("PIT could not start processing this media. Your upload is saved—try again to resume it.",
    lastError ? { cause: lastError } : undefined);
  error.code = "MEDIA_STORAGE_UNAVAILABLE";
  error.status = 503;
  error.retryable = true;
  return error;
}

export async function finalizeMediaSourceV1({
  apiCall,
  assetId,
  kind,
  body,
  signal,
  onStage,
  now = Date.now,
  wait = waitForPoll,
  pollIntervalMs = MEDIA_SOURCE_FINALIZE_POLL_INTERVAL_MS,
} = {}) {
  if (typeof apiCall !== "function" || typeof assetId !== "string" || !assetId) {
    throw new Error("PIT could not verify that media source.");
  }
  if (typeof now !== "function" || typeof wait !== "function") {
    throw new Error("PIT could not verify that media source.");
  }
  const startedAt = Number(now());
  if (!Number.isFinite(startedAt)) throw new Error("PIT could not verify that media source.");
  const startDeadline = startedAt + MEDIA_SOURCE_FINALIZE_START_TIMEOUT_MS;
  let processingDeadline = null;
  const interval = Math.max(250, Math.min(5_000, Math.round(Number(pollIntervalMs)
    || MEDIA_SOURCE_FINALIZE_POLL_INTERVAL_MS)));
  const path = `/api/media/assets/${encodeURIComponent(assetId)}`;
  let submissions = 0;
  let lastError = null;
  let reportedStage = null;
  // Video finalization owns the authoritative public rendition and must reach
  // `ready`. Photo source finalization intentionally stops at `render_pending`
  // so the client can upload its separately sanitized rendition next.
  const awaitsReadyAsset = kind === "video" || Number.isFinite(Number(body?.durationMs));

  const completed = (value) => value?.asset?.status === "ready"
    || (!awaitsReadyAsset
      // The server immediately before the async-video coordinator returned
      // only `{ asset }` here and from the owner GET. These explicit photo
      // states are already source-finalized; coordinator metadata is optional.
      && ["render_pending", "render_unavailable"].includes(value?.asset?.status));

  const reportStage = (stage) => {
    if (reportedStage === stage) return;
    reportedStage = stage;
    onStage?.(stage);
  };

  const noteProcessing = (value) => {
    if (value?.finalize?.state !== "processing") return false;
    if (processingDeadline === null) {
      const acknowledgedAt = Number(now());
      if (!Number.isFinite(acknowledgedAt)) throw new Error("PIT could not verify that media source.");
      processingDeadline = acknowledgedAt + MEDIA_SOURCE_FINALIZE_V1_TIMEOUT_MS;
    }
    reportStage("processing-source");
    return true;
  };

  const activeDeadline = () => processingDeadline ?? startDeadline;

  const submit = async () => {
    submissions += 1;
    return apiCall(`${path}/finalize`, {
      method: "POST",
      context: "Verifying your PIT media",
      signal,
      // This also supports a web-first rolling deploy whose prior server still
      // finalizes synchronously. The new server acknowledges video work quickly.
      timeoutMs: MEDIA_SOURCE_FINALIZE_REQUEST_TIMEOUT_MS,
      // Current servers always coordinate video work in the background. The
      // hint is harmless to the prior body-tolerant server during web-first
      // rollout and lets this client poll instead of holding a proxy request.
      body: { ...(body || {}), async: true },
    });
  };

  let current;
  reportStage("starting-source");
  try {
    current = await submit();
    noteProcessing(current);
  } catch (error) {
    if (signal?.aborted) throw abortError(signal);
    if (!retryableRequestFailure(error)) throw error;
    lastError = error;
    reportStage("reconnecting-source");
  }

  while (true) {
    if (completed(current)) return current;
    const failed = processingFailure(current);
    if (failed) throw failed;
    noteProcessing(current);
    if (signal?.aborted) throw abortError(signal);
    const remaining = activeDeadline() - Number(now());
    if (!Number.isFinite(remaining) || remaining <= 0) {
      throw processingDeadline === null ? startFailure(lastError) : deadlineFailure(lastError);
    }
    await wait(Math.min(interval, remaining), signal);

    const readRemaining = activeDeadline() - Number(now());
    if (!Number.isFinite(readRemaining) || readRemaining <= 0) {
      throw processingDeadline === null ? startFailure(lastError) : deadlineFailure(lastError);
    }

    try {
      current = await apiCall(path, {
        method: "GET",
        context: "Checking your PIT media",
        signal,
        timeoutMs: Math.min(20_000, readRemaining),
      });
      lastError = null;
    } catch (error) {
      if (signal?.aborted) throw abortError(signal);
      if (!retryableRequestFailure(error)) throw error;
      lastError = error;
      current = null;
      reportStage("reconnecting-source");
      continue;
    }

    if (completed(current)) return current;
    const polledFailure = processingFailure(current);
    if (polledFailure) throw polledFailure;
    if (noteProcessing(current)) continue;
    // A Render restart forgets only the process-local coordinator; the private
    // source and deterministic asset remain. Resubmit the identical finalize
    // operation at a bounded cadence so the new instance safely resumes it.
    if (!current?.finalize || current.finalize.state === "idle") {
      if (submissions >= MAX_RESTART_SUBMISSIONS) throw startFailure(lastError);
      reportStage("reconnecting-source");
      try {
        current = await submit();
        noteProcessing(current);
      } catch (error) {
        if (signal?.aborted) throw abortError(signal);
        if (!retryableRequestFailure(error)) throw error;
        lastError = error;
        current = null;
      }
    }
  }
}

/**
 * Resume an owner-only source whose PUT already completed. A pending local
 * draft may finish an existing server job without preparing or uploading the
 * device file again. A genuinely ready video is a re-edit, which remains
 * blocked until the verifier exposes an idempotent cover-regeneration command.
 */
export async function resumeExistingMediaSourceV1({
  apiCall,
  asset,
  kind,
  body,
  signal,
  onStage,
  onRemoteDraft,
} = {}) {
  const assetId = typeof asset?.assetId === "string" ? asset.assetId : "";
  if (typeof apiCall !== "function" || !assetId) {
    throw mediaSourceError("MEDIA_ASSET_INVALID", "That PIT media source is no longer available.");
  }
  if (kind === "video" && asset.status === "ready") {
    throw mediaSourceError(
      "VIDEO_COVER_REEDIT_UNAVAILABLE",
      "Verified clip covers cannot be changed yet. Remove the clip and add it again to choose a new cover.",
    );
  }

  const path = `/api/media/assets/${encodeURIComponent(assetId)}`;
  // A restored draft already owns this opaque server identity. Surface it to
  // the composer before the first network wait so Cancel can retire the source
  // even if this owner read is interrupted.
  onRemoteDraft?.({ assetId, duplicate: true, sourceUploaded: true });
  onStage?.("checking-source");
  let result = await apiCall(path, {
    context: "Checking your PIT media source",
    signal,
  });
  if (!result?.asset?.id) {
    throw mediaSourceError("MEDIA_ASSET_INVALID", "That PIT media source is no longer available.");
  }
  if (result.asset.status === "upload_pending") {
    result = await finalizeMediaSourceV1({ apiCall, assetId, kind, body, signal, onStage });
  }
  return result;
}
