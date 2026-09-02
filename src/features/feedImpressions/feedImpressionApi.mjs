const requireApiCall = (value) => {
  if (typeof value !== "function") throw new TypeError("A PIT API caller is required.");
  return value;
};

export function sendFeedImpressionBatch(impressions, { accountId, apiCall } = {}) {
  const call = requireApiCall(apiCall);
  return call("/api/feed/impressions", {
    method: "POST",
    body: { impressions },
    expectedAccountId: accountId,
    timeoutMs: 10_000,
    context: "Saving your place in the feed",
    silent: true,
  });
}
