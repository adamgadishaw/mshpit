export const SHOW_DISCUSSION_COUNT_LIMIT = 999;

export function showDiscussionCount(rawCount) {
  if (rawCount == null || typeof rawCount === "boolean") return null;
  if (typeof rawCount !== "number" && typeof rawCount !== "string") return null;
  if (typeof rawCount === "string" && !rawCount.trim()) return null;
  const numeric = Number(rawCount);
  if (!Number.isFinite(numeric) || numeric < 0) return null;

  const exact = Math.floor(numeric);
  const capped = exact > SHOW_DISCUSSION_COUNT_LIMIT;
  return Object.freeze({
    value: Math.min(exact, SHOW_DISCUSSION_COUNT_LIMIT),
    label: capped ? `${SHOW_DISCUSSION_COUNT_LIMIT}+` : String(exact),
    capped,
  });
}

export function hasPostDiscussion(log) {
  if (!log || typeof log !== "object" || Array.isArray(log)) return false;
  const id = log?.id;
  const validId = typeof id === "number"
    ? Number.isSafeInteger(id) && id > 0
    : typeof id === "string" && id.trim().length > 0;
  if (!validId) return false;

  // ShowScreen also accepts calendar/tour-date rows, and those have their own
  // persisted ids. A post discussion exists only when the row carries the
  // post-author projection returned by the posts API (legacy review posts may
  // omit `kind`, so author identity is the durable discriminator).
  const authorId = log.userId ?? log.user?.id;
  if (typeof authorId !== "string" && typeof authorId !== "number") return false;
  if (!String(authorId).trim()) return false;
  return log.kind == null || log.kind === "review" || log.kind === "status";
}
