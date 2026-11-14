export function visibleNotificationActors(rows, { current = [], mutedIds = [] } = {}, accountId = null) {
  const hidden = new Set([...current, ...mutedIds]);
  return rows.filter((row) => (accountId != null && row.userId !== accountId)
    || !row.actorId || !hidden.has(row.actorId));
}

export function reconcileConfirmedNotificationReads(rows, { accountId, notificationIds } = {}) {
  const current = Array.isArray(rows) ? rows : [];
  const ownerId = accountId == null ? "" : String(accountId);
  const ids = new Set(Array.isArray(notificationIds)
    ? notificationIds.filter((id) => id != null).map(String)
    : []);
  if (!ownerId || !ids.size) return current;
  let changed = false;
  const next = current.map((notification) => {
    if (String(notification?.userId || "") !== ownerId
      || !ids.has(String(notification?.id || ""))
      || notification.read) return notification;
    changed = true;
    return { ...notification, read: true };
  });
  return changed ? next : current;
}
export function mergeNotificationHistory(current, fetched, { accountId, capturedRows = [] } = {}) {
  const initial = new Map(capturedRows.map((row) => [row.id, row]));
  const live = new Map(current.filter((row) => row.userId === accountId).map((row) => [row.id, row]));
  const received = new Set(fetched.map((row) => row.id));
  return [
    ...fetched.map((row) => ({ ...row, userId: accountId,
      // A read confirmed while this GET was in flight must not be undone.
      read: !!row.read || (!!live.get(row.id)?.read && !initial.get(row.id)?.read),
    })),
    ...current.filter((row) => row.userId !== accountId || (!received.has(row.id)
      && (row.type === "welcome" || !initial.has(row.id)))),
  ];
}

export async function fetchNotificationHistory(request, { signal, isCurrent = () => true } = {}) {
  const rows = new Map();
  const cursors = new Set();
  let cursor = null;
  do {
    if (signal?.aborted || !isCurrent()) return null;
    const payload = await request(`/api/me/notifications${cursor ? `?before=${encodeURIComponent(cursor)}` : ""}`);
    if (signal?.aborted || !isCurrent()) return null;
    if (!Array.isArray(payload?.notifications)) throw new Error("Activity returned an invalid response.");
    for (const row of payload.notifications) rows.set(row.id, row);
    cursor = payload.nextCursor || null;
    if (cursor && cursors.has(cursor)) throw new Error("Activity pagination did not advance. Try again.");
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return [...rows.values()];
}

export function confirmedNotificationIds(response, requested) {
  if (response?.ok !== true || response.readContract !== "notification-ids-v1"
    || !Array.isArray(response.notificationIds)) throw new Error("Activity acknowledgement was not confirmed. Try again.");
  const allowed = new Set(requested);
  return [...new Set(response.notificationIds.filter((id) => allowed.has(id)))];
}
