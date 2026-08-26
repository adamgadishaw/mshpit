import { api } from "./api";

export function requestAccountExport(password) {
  return api("/api/me/export", {
    method: "POST",
    body: { password: typeof password === "string" ? password : "" },
    context: "Preparing your account export",
    silent: true,
  });
}

export function updateAnnouncementEmailPreference(enabled) {
  return api("/api/me/email-preferences", {
    method: "POST",
    body: { announcements: !!enabled },
    context: "Updating announcement email preferences",
    silent: true,
  });
}

export function updateProfileSearchIndexingPreference(enabled) {
  return api("/api/me", {
    method: "PATCH",
    body: { searchIndexingOptOut: !enabled },
    context: enabled ? "Showing your profile in search engines" : "Hiding your profile from search engines",
    silent: true,
  });
}
