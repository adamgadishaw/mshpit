export const LEGACY_COMMENT_CACHE_KEY = "pit.comments";
const COMMENT_CACHE_PREFIX = "pit.comments.v2";

const accountId = (value) => value == null || value === "" ? null : String(value);
const record = (value) => value != null && typeof value === "object" && !Array.isArray(value);

export function commentCacheStorageKey(value) {
  const normalized = accountId(value);
  return `${COMMENT_CACHE_PREFIX}.${normalized == null ? "guest" : encodeURIComponent(normalized)}`;
}

export function commentRequestCacheKey(value, postId, limit) {
  return JSON.stringify([accountId(value) || "", String(postId || ""), Number(limit) || 0]);
}

export function withoutPendingComments(value) {
  if (!record(value)) return {};
  const settled = {};
  for (const [postId, rows] of Object.entries(value)) {
    if (!Array.isArray(rows)) continue;
    const confirmed = rows.filter((comment) => comment && comment.pending !== true);
    if (confirmed.length) settled[postId] = confirmed;
  }
  return settled;
}

export function resolveAccountCommentCache({
  accountId: value = null,
  demoEnabled = false,
  demoSeed = {},
  read,
  write,
  sanitize = (candidate) => candidate,
} = {}) {
  if (typeof read !== "function" || typeof write !== "function") {
    throw new TypeError("comment cache migration requires persistence adapters");
  }
  const scopedKey = commentCacheStorageKey(value);
  const scoped = read(scopedKey, null);
  const legacy = read(LEGACY_COMMENT_CACHE_KEY, null);
  // A production cookie can belong to a different person than the account that
  // wrote the old global key. Never guess ownership. Demo identity is explicitly
  // device-local, so it may safely carry its prototype continuity forward once.
  const source = record(scoped)
    ? scoped
    : demoEnabled && record(legacy) && Object.keys(legacy).length
      ? legacy
      : demoEnabled
        ? demoSeed
        : {};
  const sanitized = sanitize(source);
  const resolved = record(sanitized) ? sanitized : {};
  write(LEGACY_COMMENT_CACHE_KEY, {});
  if (!record(scoped)) write(scopedKey, resolved);
  return resolved;
}

export function createCommentAccountCoordinator(initialAccountId = null) {
  let currentAccountId = accountId(initialAccountId);
  let epoch = 0;

  return Object.freeze({
    accountId: () => currentAccountId,
    capture: () => Object.freeze({ accountId: currentAccountId, epoch }),
    adopt(nextValue) {
      const nextAccountId = accountId(nextValue);
      if (nextAccountId === currentAccountId) {
        return Object.freeze({ changed: false, previousAccountId: currentAccountId, accountId: currentAccountId, epoch });
      }
      const previousAccountId = currentAccountId;
      currentAccountId = nextAccountId;
      epoch += 1;
      return Object.freeze({ changed: true, previousAccountId, accountId: currentAccountId, epoch });
    },
    isCurrent(claim, renderedAccountId = currentAccountId) {
      return !!claim
        && claim.accountId === currentAccountId
        && claim.epoch === epoch
        && accountId(renderedAccountId) === currentAccountId;
    },
  });
}
