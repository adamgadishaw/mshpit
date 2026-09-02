export const FEED_IMPRESSION_BATCH_MAX = 50;
export const FEED_IMPRESSION_QUEUE_MAX = 500;
export const FEED_IMPRESSION_FLUSH_MS = 1_500;

const POST_ID = /^p_[A-Za-z0-9_-]{1,77}$/;
const SURFACES = new Set(["feed", "for_you", "following", "local", "clips", "profile", "post", "artist"]);

const normalizedAccountId = (value) => (
  typeof value === "string" && value.trim() ? value.trim() : null
);

const normalizedSurface = (value) => (
  SURFACES.has(String(value || "")) ? String(value) : "feed"
);

export function isFeedImpressionPostId(value) {
  return typeof value === "string" && POST_ID.test(value);
}

// Account-private functional history is intentionally separate from optional
// product analytics. The queue is memory-only, bounded, and fenced by account
// generation so a shared browser can never replay A's view as B.
export function createFeedImpressionQueue({
  send,
  schedule = setTimeout,
  cancel = clearTimeout,
  now = Date.now,
  random = Math.random,
  flushDelayMs = FEED_IMPRESSION_FLUSH_MS,
} = {}) {
  if (typeof send !== "function") throw new TypeError("A feed impression sender is required.");
  let accountId = null;
  let generation = 0;
  let sequence = 0;
  let timer = null;
  let inFlight = null;
  let active = true;
  let disposed = false;
  let retryDelayMs = 2_000;
  const viewedPosts = new Set();
  const pending = new Map();

  const clearTimer = () => {
    if (timer == null) return;
    cancel(timer);
    timer = null;
  };

  const scheduleFlush = (delay) => {
    if (disposed || !active || !accountId || !pending.size || timer != null) return;
    timer = schedule(() => {
      timer = null;
      void flush();
    }, Math.max(0, Number(delay) || 0));
  };

  const eventId = () => {
    sequence = (sequence + 1) % 1_000_000;
    const entropy = Math.floor(Math.max(0, Math.min(0.999999999, Number(random()) || 0)) * 0xFFFFFFFF)
      .toString(36)
      .padStart(6, "0");
    return `imp_${Math.max(0, Number(now()) || 0).toString(36)}_${sequence.toString(36)}_${entropy}`;
  };

  async function flush() {
    if (disposed || !accountId || !pending.size) return false;
    if (inFlight) return inFlight;
    clearTimer();
    const expectedAccountId = accountId;
    const expectedGeneration = generation;
    const batch = [...pending.values()].slice(0, FEED_IMPRESSION_BATCH_MAX);
    inFlight = Promise.resolve(send(batch, { accountId: expectedAccountId }))
      .then(() => {
        if (disposed || generation !== expectedGeneration || accountId !== expectedAccountId) return false;
        for (const entry of batch) pending.delete(entry.eventId);
        retryDelayMs = 2_000;
        if (pending.size) scheduleFlush(0);
        return true;
      })
      .catch(() => {
        if (!disposed && generation === expectedGeneration && accountId === expectedAccountId && active) {
          scheduleFlush(retryDelayMs);
          retryDelayMs = Math.min(60_000, retryDelayMs * 2);
        }
        return false;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  const configure = (nextAccountId) => {
    const next = normalizedAccountId(nextAccountId);
    if (next === accountId) return;
    generation += 1;
    accountId = next;
    retryDelayMs = 2_000;
    clearTimer();
    viewedPosts.clear();
    pending.clear();
  };

  const record = ({ postId, surface } = {}) => {
    if (disposed || !active || !accountId || !isFeedImpressionPostId(postId)
        || viewedPosts.has(postId) || pending.size >= FEED_IMPRESSION_QUEUE_MAX) return false;
    const entry = { postId, eventId: eventId(), surface: normalizedSurface(surface) };
    viewedPosts.add(postId);
    pending.set(entry.eventId, entry);
    if (pending.size >= 20) void flush();
    else scheduleFlush(flushDelayMs);
    return true;
  };

  const setActive = (nextActive) => {
    const next = nextActive === true;
    if (next === active) return;
    active = next;
    clearTimer();
    if (active && pending.size) scheduleFlush(0);
    else if (!active && pending.size) void flush();
  };

  const dispose = () => {
    disposed = true;
    generation += 1;
    clearTimer();
    viewedPosts.clear();
    pending.clear();
  };

  return {
    configure,
    record,
    flush,
    setActive,
    dispose,
    snapshot: () => ({
      accountId,
      active,
      pending: [...pending.values()],
      viewedPostIds: [...viewedPosts],
      retryDelayMs,
    }),
  };
}
