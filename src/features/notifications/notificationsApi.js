import { api, AppError } from "../../lib/api";

export const fetchNotificationPage = ({ accountId, cursor = null, limit = 100, signal }) => api(
  `/api/me/notifications?limit=${limit}${cursor ? `&before=${encodeURIComponent(cursor)}` : ""}`,
  { expectedAccountId: accountId, signal, cache: "no-store", silent: true, context: "Refreshing activity" },
);

// A distinct route makes old/mixed-version servers fail safely with 404 rather
// than interpreting this as their legacy mark-everything-read command.
export const writeNotificationReads = async ({ accountId, notificationIds, signal }) => {
  const response = await api("/api/me/notifications/read/scoped", {
    method: "POST", body: { notificationIds }, expectedAccountId: accountId, signal,
    silent: true, context: "Marking selected activity as read",
  });
  if (response?.ok !== true) throw new AppError("Activity read status could not be confirmed.", { code: "PIT-API-001", retryable: true });
  return { readContract: response.readContract, notificationIds: response.notificationIds, unread: response.unread };
};
