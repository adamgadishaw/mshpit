import { ApiError } from "./errors.js";

// Leave worker capacity for filesystem/DNS/image work. Bound retained password
// requests as well; credentials never enter a cache or diagnostic record.
export function createPasswordWorkQueue({ concurrency = 2, maxQueued = 32 } = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || !Number.isInteger(maxQueued) || maxQueued < 0) {
    throw new TypeError("Invalid password work limits");
  }
  let active = 0;
  const pending = [];
  const start = ({ work, resolve, reject }) => {
    active++;
    void Promise.resolve().then(work).then(resolve, reject).finally(() => {
      active--;
      if (pending.length) start(pending.shift());
    });
  };
  return (work) => {
    if (typeof work !== "function") return Promise.reject(new TypeError("Password work must be a function"));
    if (active >= concurrency && pending.length >= maxQueued) {
      return Promise.reject(new ApiError(429, "Sign-in is busy. Wait a moment and try again.", "RATE_LIMITED"));
    }
    return new Promise((resolve, reject) => {
      const job = { work, resolve, reject };
      if (active < concurrency) start(job);
      else pending.push(job);
    });
  };
}

export const passwordWork = createPasswordWorkQueue();
