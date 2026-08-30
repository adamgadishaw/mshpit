import { api } from "../../../lib/api";

export function readAdminAnalytics({ signal } = {}) {
  return api("/api/admin/analytics", {
    signal,
    silent: true,
    context: "Loading audience analytics",
  });
}

export function readAdminMemberAnalytics(userId, { signal } = {}) {
  return api(`/api/admin/analytics/users/${encodeURIComponent(userId)}`, {
    signal,
    silent: true,
    context: "Loading member activity",
  });
}

export function readAdminBadges({ signal } = {}) {
  return api("/api/admin/badges", {
    signal,
    silent: true,
    context: "Refreshing member controls",
  });
}

export function readAdminErrors({ signal } = {}) {
  return api("/api/admin/errors", {
    signal,
    silent: true,
    context: "Refreshing site errors",
  });
}

export function sendAdminErrorTestAlert() {
  return api("/api/admin/errors/test-alert", {
    method: "POST",
    body: {},
    context: "Sending a test alert",
  });
}

export function updateAdminUserBadge(userId, { slug, revoke }) {
  return api(`/api/admin/users/${encodeURIComponent(userId)}/badges`, {
    method: "POST",
    body: { slug, revoke },
    context: revoke ? "Removing a badge" : "Granting a badge",
  });
}
