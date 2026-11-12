export function createLocalAlertApi({ apiCall }) {
  const request = async (path, { accountId, signal, method = "GET", body } = {}) => {
    if (!accountId) throw new TypeError("Log in to manage notifications.");
    signal?.throwIfAborted();
    const result = await apiCall(`/api/me/local-alerts${path}`, { method, body, expectedAccountId: accountId, signal, silent: true, context: "Managing local show notifications" });
    signal?.throwIfAborted();
    return result;
  };
  return {
    preferences: options => request("/preferences", options),
    setPreferences: options => request("/preferences", { ...options, method: "PUT" }),
    binding: options => request("/devices/binding", { ...options, method: "POST" }),
    register: options => request("/devices", { ...options, method: "POST" }),
    revoke: options => request("/devices", { ...options, method: "DELETE" }),
    target: ({ alertId, ...options }) => request(`/${encodeURIComponent(alertId)}/target`, options),
  };
}
