import { api } from "../../lib/api";

export function loadLinkedAccounts(accountId, { signal } = {}) {
  return api("/api/me/accounts", { expectedAccountId: accountId, signal, cache: "no-store", silent: true, context: "Loading your accounts" });
}

export function connectLinkedAccounts(accountId, password, { signal } = {}) {
  return api("/api/me/accounts/connect", { method: "POST", body: { password }, expectedAccountId: accountId, signal, silent: true, context: "Connecting your accounts" });
}

export function switchLinkedAccountRequest(sourceId, targetId) {
  return api("/api/me/accounts/switch", { method: "POST", body: { accountId: targetId }, expectedAccountId: sourceId, silent: true, context: "Switching accounts" });
}

export function changeAccountPassword(accountId, currentPassword, password, { signal } = {}) {
  return api("/api/me/password", { method: "POST", body: { currentPassword, password },
    expectedAccountId: accountId, signal, silent: true, context: "Changing your password" });
}

export async function cancelSignupRequest(cancelToken) {
  const result = await api("/api/signup/cancel", { method: "POST", body: { cancelToken },
    skipIdentityCheck: true, silent: true, context: "Cancelling signup" });
  if (result?.ok !== true) throw new Error("Cancellation could not be confirmed. Please try again.");
  return result;
}
