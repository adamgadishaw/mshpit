export async function fetchMyShowPlans({ accountId, signal } = {}, services = {}) {
  const apiCall = services.apiCall;
  if (typeof apiCall !== "function") throw new TypeError("Show-plan transport is unavailable");
  const actorId = typeof accountId === "string" && accountId.trim() ? accountId.trim() : null;
  if (!actorId) throw new TypeError("Show plans require an authenticated account");
  const payload = await apiCall("/api/me/going", {
    signal,
    silent: true,
    expectedAccountId: actorId,
    context: "Refreshing your show plans",
  });
  if (!Array.isArray(payload?.going) || !Array.isArray(payload?.attendance)) {
    throw new TypeError("The show-plan response was invalid");
  }
  return { going: payload.going, attendance: payload.attendance };
}
