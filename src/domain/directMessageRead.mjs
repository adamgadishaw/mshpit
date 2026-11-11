function cleanCursor(value) {
  const createdAt = Number(value?.createdAt);
  const id = typeof value?.id === "string" ? value.id : "";
  return Number.isSafeInteger(createdAt) && createdAt >= 0 && id
    ? { createdAt, id }
    : null;
}

export function normalizeDirectMessageReadCursor(value) {
  return cleanCursor(value);
}

export function latestDirectMessageReadCursor(left, right) {
  const a = cleanCursor(left);
  const b = cleanCursor(right);
  if (!a) return b;
  if (!b) return a;
  return b.createdAt > a.createdAt || (b.createdAt === a.createdAt && b.id > a.id) ? b : a;
}

// Reply evidence shares the existing account-private read record. Explicit false
// withdraws an older proof; a legacy response without the field cannot invent it.
export function mergeDirectMessageReadSummary(current, summary, { revision } = {}) {
  const previous = cleanCursor(current);
  const incoming = cleanCursor(summary?.readCursor);
  const cursor = latestDirectMessageReadCursor(previous, incoming);
  // A cursor-free summary must not discard the demo mode's read count.
  if (!cursor && Number.isSafeInteger(current) && current >= 0) return current;
  const requestState = current?.requestState === "accepted" ? "accepted"
    : ["accepted", "pending", "none"].includes(summary?.requestState) ? summary.requestState : current?.requestState;
  const hasReplied = typeof summary?.hasReplied === "boolean" ? summary.hasReplied : current?.hasReplied;
  const advanced = !!incoming && (!previous || directMessageIsAfterCursor(incoming, previous));
  const staleCursor = !!previous && (!incoming || directMessageIsAfterCursor(previous, incoming));
  const boundary = cleanCursor(summary?.latestIncomingCursor);
  const validSnapshot = Number.isSafeInteger(summary?.unread) && summary.unread >= 0
    && Object.prototype.hasOwnProperty.call(summary, "latestIncomingCursor")
    && (boundary || (summary.latestIncomingCursor === null && summary.unread === 0));
  const order = Number.isSafeInteger(revision) ? revision : 0;
  const newerSnapshot = order >= (current?.summaryRevision || 0);
  const adoptSnapshot = validSnapshot && !staleCursor && (advanced || newerSnapshot);
  // A bare new cursor has no complete count. Keep the legacy cached fallback
  // until an authoritative response arrives, rather than retain a stale total.
  const retained = !advanced && Number.isSafeInteger(current?.unread)
    ? { unread: current.unread, latestIncomingCursor: current.latestIncomingCursor,
      unreadCoverageCursor: current.unreadCoverageCursor ?? current.latestIncomingCursor, summaryRevision: current.summaryRevision || 0 }
    : {};
  const counts = adoptSnapshot ? {
    unread: summary.unread, latestIncomingCursor: boundary,
    // A removal may lower the current latest inbound ID. Its old cached row
    // must not become a "new arrival" merely because its tombstone fell beyond
    // a bounded removal response. Retain the range already covered by totals.
    unreadCoverageCursor: latestDirectMessageReadCursor(current?.unreadCoverageCursor ?? current?.latestIncomingCursor, boundary),
    summaryRevision: Math.max(order, current?.summaryRevision || 0),
  } : retained;
  if (!cursor && typeof hasReplied !== "boolean" && !Number.isSafeInteger(counts.unread) && !requestState) return current;
  return { ...cursor, ...(typeof hasReplied === "boolean" ? { hasReplied } : {}), ...(requestState ? { requestState } : {}), ...counts };
}

export function latestIncomingDirectMessageId(messages, accountId) {
  const ownerId = typeof accountId === "string" ? accountId.trim() : "";
  if (!ownerId || !Array.isArray(messages)) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const id = typeof message?.id === "string" ? message.id.trim() : "";
    const senderId = typeof message?.from === "string" ? message.from.trim() : "";
    if (id && senderId && senderId !== ownerId) return id;
  }
  return null;
}

export function directMessageIsAfterCursor(message, cursor) {
  const read = cleanCursor(cursor);
  if (!read) return true;
  const createdAt = Number(message?.at ?? message?.createdAt);
  const id = typeof message?.id === "string" ? message.id : "";
  if (!Number.isSafeInteger(createdAt) || createdAt < 0 || !id) return true;
  return createdAt > read.createdAt || (createdAt === read.createdAt && id > read.id);
}

export function directMessageUnreadCount(messages, { accountId, cursor, legacyReadCount } = {}) {
  const rows = Array.isArray(messages) ? messages : [];
  if (Number.isSafeInteger(legacyReadCount) && legacyReadCount >= 0) {
    return rows.filter((message, index) => message?.from !== accountId && index >= legacyReadCount).length;
  }
  if (Number.isSafeInteger(cursor?.unread) && cursor.unread >= 0
    && (cleanCursor(cursor.latestIncomingCursor) || cursor.latestIncomingCursor === null)) {
    // The total includes all history through the server snapshot boundary.
    // Add only newer confirmed inbound rows; a partial window is never a total.
    return cursor.unread + rows.filter((message) => message?.from && message.from !== accountId
      && !message.pending && !message.failed
      && directMessageIsAfterCursor(message, cursor.unreadCoverageCursor ?? cursor.latestIncomingCursor)
      && directMessageIsAfterCursor(message, cursor)).length;
  }
  return rows.filter((message) => message?.from !== accountId && directMessageIsAfterCursor(message, cursor)).length;
}
