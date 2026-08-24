const PAGE_SIZE = 30;

const expectedAccountId = (value) => value == null || value === "" ? null : String(value);

export function profileHistoryRequest({ accountId = null, targetId, before = null } = {}) {
  const target = targetId == null ? "" : String(targetId).trim();
  if (!target) throw new TypeError("Profile history requires a target account");
  if (before != null && (typeof before !== "string" || !before.trim())) {
    throw new TypeError("Profile history cursor is invalid");
  }
  const query = [`limit=${PAGE_SIZE}`];
  if (before) query.push(`before=${encodeURIComponent(before)}`);
  return Object.freeze({
    path: `/api/users/${encodeURIComponent(target)}/posts?${query.join("&")}`,
    expectedAccountId: expectedAccountId(accountId),
  });
}

export function profileHistoryFromResponse(payload) {
  if (!payload || !Array.isArray(payload.posts) || !Object.prototype.hasOwnProperty.call(payload, "nextCursor")) {
    throw new TypeError("Profile history response is invalid");
  }
  if (payload.nextCursor !== null && (typeof payload.nextCursor !== "string" || !payload.nextCursor)) {
    throw new TypeError("Profile history cursor response is invalid");
  }
  return { posts: payload.posts, nextCursor: payload.nextCursor };
}
