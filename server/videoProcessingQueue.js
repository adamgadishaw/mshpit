import { ApiError } from "./errors.js";

// Durable bookkeeping for clip conversions. The in-process coordinator in
// videoFinalizeJobs.js runs one attempt at a time; this table remembers which
// clips still need converting, how many attempts they have had, and when to
// try again. A restart, a deploy or a converter hiccup therefore never strands
// a clip, and nobody has to keep a composer open for it to finish.

// Waits between attempts. Together they cover a converter redeploy or a short
// storage outage (about two and a half hours) without hammering either.
const RETRY_DELAYS_MS = Object.freeze([
  30_000, 60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 20 * 60_000, 40 * 60_000, 60 * 60_000,
]);
export const VIDEO_PROCESSING_MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
// A conflict usually means the file itself disagrees with its metadata, which
// another full conversion will not change. Allow one retry, then stop.
const CONFLICT_MAX_ATTEMPTS = 2;
// The converter was busy with another clip. Not the clip's fault, not counted.
const BUSY_RETRY_MS = 20_000;
// Final answers about the file or the request. Another attempt cannot help.
const FINAL_STATUSES = new Set([400, 401, 403, 404, 413, 415, 422]);

const FAILURE_MESSAGES = Object.freeze({
  413: "That clip is too large to convert.",
  415: "That clip couldn't be converted. The file may be damaged or in a format we can't read.",
  422: "That clip couldn't be converted.",
  429: "Clip processing is busy for this account or network. Try again later.",
});

function errorStatus(error) {
  return error instanceof ApiError ? Number(error.status) || 500 : 500;
}

function errorCode(error) {
  return error instanceof ApiError && typeof error.code === "string" ? error.code : "INTERNAL_ERROR";
}

export function recordVideoProcessingRequest(database, { ownerId, assetId, body, fingerprint, at = Date.now() } = {}) {
  // A member's request resets the count after a final failure (they asked to
  // try again) but keeps it while automatic retries are still pending.
  database.prepare(`INSERT INTO media_processing_jobs
      (asset_id,owner_id,body,fingerprint,state,attempts,next_attempt_at,last_error_code,last_error_status,created_at,updated_at)
    VALUES (?,?,?,?,'running',0,NULL,NULL,NULL,?,?)
    ON CONFLICT(asset_id) DO UPDATE SET
      body=excluded.body,
      fingerprint=excluded.fingerprint,
      state='running',
      attempts=CASE WHEN media_processing_jobs.state='failed' THEN 0 ELSE media_processing_jobs.attempts END,
      next_attempt_at=NULL,
      updated_at=excluded.updated_at`)
    .run(assetId, ownerId, JSON.stringify(body ?? {}), fingerprint, at, at);
}

export function noteVideoProcessingAttemptStarted(database, { assetId, at = Date.now() } = {}) {
  database.prepare(`UPDATE media_processing_jobs SET attempts=attempts+1,state='running',next_attempt_at=NULL,updated_at=?
    WHERE asset_id=?`).run(at, assetId);
}

// Records how one attempt ended. Success removes the row; the asset itself is
// then ready. Returns the new state for logging and tests.
export function noteVideoProcessingOutcome(database, { assetId, error = null, at = Date.now() } = {}) {
  if (!error) {
    database.prepare("DELETE FROM media_processing_jobs WHERE asset_id=?").run(assetId);
    return { state: "completed" };
  }
  const row = database.prepare("SELECT attempts FROM media_processing_jobs WHERE asset_id=?").get(assetId);
  if (!row) return { state: "gone" };
  const status = errorStatus(error);
  const code = errorCode(error);
  const attempts = Math.max(0, Number(row.attempts) || 0);
  let state;
  let nextAttemptAt = null;
  let countedAttempts = attempts;
  if (error?.name === "AbortError") {
    // Only an owner deleting the draft aborts a job; the row is normally
    // already gone. If not, leave it for the next start to pick up.
    state = "retry";
    nextAttemptAt = at + BUSY_RETRY_MS;
    countedAttempts = Math.max(0, attempts - 1);
  } else if (status === 429 && error?.videoAdmissionDenied === true) {
    // Only converter contention may retry without a new member request. An
    // account/IP admission denial must be rechecked by that request's context.
    state = "failed";
    countedAttempts = Math.max(0, attempts - 1);
  } else if (status === 429) {
    state = "retry";
    nextAttemptAt = at + BUSY_RETRY_MS;
    countedAttempts = Math.max(0, attempts - 1);
  } else if (FINAL_STATUSES.has(status)
      || (status === 409 && attempts >= CONFLICT_MAX_ATTEMPTS)
      || attempts >= VIDEO_PROCESSING_MAX_ATTEMPTS) {
    state = "failed";
  } else {
    state = "retry";
    nextAttemptAt = at + RETRY_DELAYS_MS[Math.min(RETRY_DELAYS_MS.length - 1, Math.max(0, attempts - 1))];
  }
  database.prepare(`UPDATE media_processing_jobs SET state=?,attempts=?,next_attempt_at=?,last_error_code=?,last_error_status=?,updated_at=?
    WHERE asset_id=?`).run(state, countedAttempts, nextAttemptAt, code, status, at, assetId);
  return { state, nextAttemptAt, attempts: countedAttempts };
}

// A process that stopped mid-conversion left its rows marked running. Nothing
// is running at start-up, so they are all due now.
export function recoverInterruptedVideoProcessing(database, { at = Date.now() } = {}) {
  return Number(database.prepare(`UPDATE media_processing_jobs SET state='retry',next_attempt_at=?,updated_at=?
    WHERE state='running'`).run(at, at).changes || 0);
}

export function dueVideoProcessingJob(database, { at = Date.now() } = {}) {
  return database.prepare(`SELECT asset_id,owner_id,body,fingerprint,attempts FROM media_processing_jobs
    WHERE state='retry' AND next_attempt_at<=?
    ORDER BY next_attempt_at ASC, created_at ASC, asset_id ASC LIMIT 1`).get(at) || null;
}

export function postponeVideoProcessing(database, { assetId, delayMs = BUSY_RETRY_MS, at = Date.now() } = {}) {
  database.prepare(`UPDATE media_processing_jobs SET next_attempt_at=?,updated_at=? WHERE asset_id=? AND state='retry'`)
    .run(at + delayMs, at, assetId);
}

function publicProcessingState(row) {
  if (!row) return null;
  if (row.state === "failed") {
    const status = Number(row.last_error_status) || 500;
    return {
      state: "failed",
      error: {
        code: row.last_error_code || "MEDIA_STORAGE_UNAVAILABLE",
        status,
        message: FAILURE_MESSAGES[status] || "That clip couldn't be converted after several tries.",
        retryable: !FINAL_STATUSES.has(status),
      },
    };
  }
  return {
    state: "processing",
    attempts: Number(row.attempts) || 0,
    ...(row.state === "retry" && Number.isSafeInteger(Number(row.next_attempt_at))
      ? { retryAt: Number(row.next_attempt_at) } : {}),
  };
}

export function videoProcessingState(database, { ownerId, assetId } = {}) {
  const row = database.prepare(`SELECT state,attempts,next_attempt_at,last_error_code,last_error_status
    FROM media_processing_jobs WHERE asset_id=? AND owner_id=?`).get(assetId, ownerId);
  return publicProcessingState(row);
}

export function videoProcessingStatesByAsset(database, assetIds) {
  const ids = [...new Set((Array.isArray(assetIds) ? assetIds : []).filter((id) => typeof id === "string" && id))].slice(0, 200);
  const states = new Map();
  if (!ids.length) return states;
  const rows = database.prepare(`SELECT asset_id,state,attempts,next_attempt_at,last_error_code,last_error_status
    FROM media_processing_jobs WHERE asset_id IN (${ids.map(() => "?").join(",")})`).all(...ids);
  for (const row of rows) states.set(row.asset_id, publicProcessingState(row));
  return states;
}

export function startVideoProcessingScheduler({
  database,
  resume,
  isBusy = () => false,
  now = Date.now,
  intervalMs = 15_000,
  onError = (error) => console.error(`[media] clip retry scheduler failed safely: ${errorCode(error)}`),
} = {}) {
  if (!database || typeof resume !== "function") throw new Error("Clip retry scheduler needs a database and a resume function.");
  const recovered = recoverInterruptedVideoProcessing(database, { at: now() });
  if (recovered) console.log(`[media] resuming ${recovered} clip conversion(s) interrupted by a restart`);
  let stopped = false;
  const tick = () => {
    if (stopped) return false;
    try {
      if (isBusy()) return false;
      const due = dueVideoProcessingJob(database, { at: now() });
      if (!due) return false;
      resume(due);
      return true;
    } catch (error) {
      onError(error);
      return false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  const first = setTimeout(tick, 2_000);
  first.unref?.();
  return {
    tick,
    stop() {
      stopped = true;
      clearInterval(timer);
      clearTimeout(first);
    },
  };
}
