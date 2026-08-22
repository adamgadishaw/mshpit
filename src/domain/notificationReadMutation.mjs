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
