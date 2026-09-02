import { api } from "../../lib/api";

export const fetchMutedAccounts = (accountId) => api("/api/me/muted", {
  silent: true,
  context: "Loading muted accounts",
  expectedAccountId: accountId,
});

export const saveAccountMute = (id, muted) => api(`/api/users/${id}/mute`, {
  method: "POST",
  body: { muted },
  context: muted ? "Muting this account" : "Unmuting this account",
});
