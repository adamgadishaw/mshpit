import { api } from "./api";

export function requestAccountExport(password, { expectedAccountId, signal } = {}) {
  return api("/api/me/export", {
    method: "POST",
    body: { password: typeof password === "string" ? password : "" },
    context: "Preparing your account export",
    silent: true,
    expectedAccountId,
    signal,
  });
}

export function updateAnnouncementEmailPreference(enabled, { expectedAccountId, signal } = {}) {
  return api("/api/me/email-preferences", {
    method: "POST",
    body: { announcements: !!enabled },
    expectedAccountId, signal,
    context: "Updating announcement email preferences",
    silent: true,
  });
}

export function updateProfileSearchIndexingPreference(enabled, { expectedAccountId, signal } = {}) {
  return api("/api/me", {
    method: "PATCH",
    body: { searchIndexingOptOut: !enabled },
    expectedAccountId, signal,
    context: enabled ? "Showing your profile in search engines" : "Hiding your profile from search engines",
    silent: true,
  });
}

export function updateDirectMessagePreference(directMessagePolicy, { expectedAccountId, signal } = {}) {
  return api("/api/me", {
    method: "PATCH",
    body: { directMessagePolicy },
    expectedAccountId, signal,
    context: "Updating who can message you",
    silent: true,
  });
}

export function classifyAccountAgeBand(ageBand, { expectedAccountId, signal } = {}) {
  return api("/api/me", {
    method: "PATCH",
    body: { ageBand },
    expectedAccountId, signal,
    context: "Saving your age group for account safety",
    silent: true,
  });
}

export function updateProfileAudience(profileAudience, { expectedAccountId, signal } = {}) {
  return api("/api/me", {
    method: "PATCH",
    body: { profileAudience },
    expectedAccountId, signal,
    context: "Updating who can see your profile",
    silent: true,
  });
}
