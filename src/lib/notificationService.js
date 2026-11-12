import { api } from "./api";
import { fetchNotificationHistory } from "../domain/notificationReadMutation.mjs";

export function loadNotificationHistory({ signal, isCurrent, expectedAccountId } = {}) {
  return fetchNotificationHistory((path) => api(path, {
    context: "Refreshing activity", silent: true, signal, expectedAccountId,
  }), { signal, isCurrent });
}

export function acknowledgeNotificationBatch(notificationIds, { signal, context, expectedAccountId } = {}) {
  return api("/api/me/notifications/read/scoped", {
    method: "POST", body: { notificationIds }, context, silent: true, signal, expectedAccountId,
  });
}
