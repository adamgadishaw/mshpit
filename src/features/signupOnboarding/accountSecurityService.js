import { api } from "../../lib/api";

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
