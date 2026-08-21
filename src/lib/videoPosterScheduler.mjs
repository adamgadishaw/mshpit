import { VIDEO_POSTER_ERROR_CODES, VideoPosterError } from "../domain/videoPoster.mjs";

export const DEFAULT_VIDEO_POSTER_CONCURRENCY = 2;
export const VIDEO_POSTER_PERMIT_UNTIL = Symbol.for("pit.videoPoster.permitUntil");

const abortedError = () => new VideoPosterError(VIDEO_POSTER_ERROR_CODES.aborted);

function normalizedConcurrency(value) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.min(4, Math.max(1, number)) : DEFAULT_VIDEO_POSTER_CONCURRENCY;
}

// Native thumbnail/image operations cannot be cancelled once dispatched. The
// caller-facing promise may still reject immediately, while this tracker keeps
// the scheduler permit until every deferred native operation and its cleanup
// have actually settled.
export function createVideoPosterWorkTracker() {
  const pending = new Set();
  let operationFinished = false;
  let resolveSettled;
  const settled = new Promise((resolve) => { resolveSettled = resolve; });
  const finishIfReady = () => {
    if (operationFinished && pending.size === 0) resolveSettled();
  };
  return Object.freeze({
    settled,
    hold(operation) {
      const tracked = Promise.resolve(operation).then(() => undefined, () => undefined);
      pending.add(tracked);
      void tracked.then(() => {
        pending.delete(tracked);
        finishIfReady();
      });
      return operation;
    },
    finish() {
      operationFinished = true;
      finishIfReady();
    },
  });
}

export function markVideoPosterPermitUntil(result, permitUntil) {
  if (!result || typeof result.then !== "function" || !permitUntil || typeof permitUntil.then !== "function") return result;
  Object.defineProperty(result, VIDEO_POSTER_PERMIT_UNTIL, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: permitUntil,
  });
  return result;
}

// One scheduler instance is shared by every ClipPoster. The limit counts jobs
// until their underlying decoder work actually settles; aborting a component
// never releases a slot early while native/web cleanup is still running.
export function createVideoPosterGenerationScheduler({ maxConcurrent = DEFAULT_VIDEO_POSTER_CONCURRENCY } = {}) {
  const limit = normalizedConcurrency(maxConcurrent);
  const queue = [];
  let active = 0;

  const snapshot = () => ({ active, queued: queue.length, limit });

  const pump = () => {
    while (active < limit && queue.length) {
      const job = queue.shift();
      job.removeAbortListener();
      if (job.signal?.aborted) {
        job.reject(abortedError());
        continue;
      }

      job.state = "running";
      active += 1;
      Promise.resolve()
        .then(() => {
          if (job.signal?.aborted) throw abortedError();
          const result = job.operation();
          const callerResult = Promise.resolve(result);
          const permitUntil = result?.[VIDEO_POSTER_PERMIT_UNTIL];
          if (!permitUntil) return callerResult.then(job.resolve, job.reject);
          // Settle the caller independently from the permit. Native cancellation
          // stays prompt even when generateThumbnailsAsync must finish in the
          // background before its player/shared refs can be released.
          void callerResult.then(job.resolve, job.reject);
          return Promise.resolve(permitUntil).then(() => undefined, () => undefined);
        })
        .catch(job.reject)
        .finally(() => {
          active = Math.max(0, active - 1);
          pump();
        });
    }
  };

  const schedule = (operation, { signal = null } = {}) => {
    if (typeof operation !== "function") return Promise.reject(new TypeError("Poster generation requires an operation."));
    if (signal?.aborted) return Promise.reject(abortedError());

    return new Promise((resolve, reject) => {
      const job = {
        operation,
        signal,
        resolve,
        reject,
        state: "queued",
        removeAbortListener: () => {},
      };
      const onAbort = () => {
        if (job.state !== "queued") return;
        job.state = "cancelled";
        const index = queue.indexOf(job);
        if (index >= 0) queue.splice(index, 1);
        job.removeAbortListener();
        reject(abortedError());
      };
      job.removeAbortListener = () => signal?.removeEventListener?.("abort", onAbort);
      signal?.addEventListener?.("abort", onAbort, { once: true });
      queue.push(job);
      pump();
    });
  };

  return Object.freeze({ schedule, snapshot });
}

const sharedVideoPosterScheduler = createVideoPosterGenerationScheduler();

export function scheduleVideoPosterGeneration(operation, options) {
  return sharedVideoPosterScheduler.schedule(operation, options);
}
