const DEFAULT_POSTER_SECONDS = 0.35;
const MAX_POSTER_SECONDS = 2;
export const DURABLE_POSTER_RETRY_DELAY_MS = 700;

// A video's first encoded frame is often a black camera start or export slate.
// Pick a representative frame near the beginning without ever seeking past the
// final tenth of a second. Keeping this pure makes the native thumbnail and web
// paused-frame implementations choose the exact same moment.
export function clipPosterTime(duration) {
  const seconds = Number(duration);
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_POSTER_SECONDS;
  const latestSafeFrame = Math.max(0, seconds - 0.1);
  return Math.min(Math.max(DEFAULT_POSTER_SECONDS, seconds * 0.08), MAX_POSTER_SECONDS, latestSafeFrame);
}

// Reel pages are potentially unbounded. Warming only the active page and its
// immediate neighbours avoids creating a decoder/network request for every
// clip while still making the next swipe land on a real frame.
export function shouldWarmClipPoster({ index, activeIndex, radius = 1 } = {}) {
  const page = Number(index);
  const active = Number(activeIndex);
  const distance = Math.max(0, Number(radius) || 0);
  return Number.isInteger(page) && Number.isInteger(active) && Math.abs(page - active) <= distance;
}

export function clipPosterPhase({ enabled = true, hasVisual = false, error = null, status = "idle" } = {}) {
  if (!enabled) return "idle";
  if (hasVisual) return "ready";
  if (error || status === "error") return "error";
  return "loading";
}

export function durablePosterFailurePlan(failures = 0) {
  const nextFailures = Math.max(0, Math.floor(Number(failures) || 0)) + 1;
  return nextFailures < 2
    ? { failures: nextFailures, terminal: false, retryAfterMs: DURABLE_POSTER_RETRY_DELAY_MS }
    : { failures: nextFailures, terminal: true, retryAfterMs: 0 };
}

export function durablePosterEventOwnsInstance(state, { uri = null, retryVersion = 0 } = {}) {
  return !!state
    && state.uri === uri
    && state.retryVersion === retryVersion
    && !state.retrying;
}
