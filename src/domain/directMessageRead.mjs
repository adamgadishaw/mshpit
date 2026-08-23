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
  return rows.filter((message) => message?.from !== accountId && directMessageIsAfterCursor(message, cursor)).length;
}
