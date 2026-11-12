// Expo tickets mean accepted for delivery. Only receipt status=ok means the
// provider accepted it; neither proves the user saw a notification. The caller
// retains unknown outcomes and never blindly repeats a timed-out dispatch.
export function createExpoPushTransport({ fetchImpl, accessToken = null, timeoutMs = 15_000 }) {
  if (typeof fetchImpl !== "function") throw new TypeError("An explicit push transport is required");
  const post = async (path, body) => fetchImpl(`https://exp.host/--/api/v2/push/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(Math.min(Math.max(timeoutMs, 1000), 30_000)),
  });
  return {
    async send(message) {
      const response = await post("send", message);
      if (response.status === 429) return { status: "rejected", code: "RateLimited" };
      if (!response.ok) return { status: response.status >= 500 ? "unknown" : "rejected", code: "ProviderRejected" };
      const result = await response.json();
      const data = Array.isArray(result?.data) ? result.data[0] : result?.data;
      if (data?.status === "ok" && typeof data.id === "string") return { status: "accepted", ticketId: data.id };
      if (data?.status === "error") return { status: "rejected", code: data.details?.error === "DeviceNotRegistered" ? "DeviceNotRegistered" : "ProviderRejected" };
      return { status: "unknown" };
    },
    async receipt(ticketId) {
      const response = await post("getReceipts", { ids: [ticketId] });
      if (!response.ok) return { status: "pending" };
      const result = await response.json(), data = result?.data?.[ticketId];
      if (data?.status === "ok") return { status: "delivered" };
      if (data?.status === "error") return { status: "rejected", code: data.details?.error === "DeviceNotRegistered" ? "DeviceNotRegistered" : "ProviderRejected" };
      return { status: "pending" };
    },
  };
}
