function boundedToken(value, fallback, limit = 80) {
  const token = String(value || "").replace(/[^A-Za-z0-9_./:<>*-]/g, "").slice(0, limit);
  return token || fallback;
}

export function safeRequestFailureContext({ method, pathname, routePattern, error } = {}) {
  const route = routePattern
    ? boundedToken(routePattern, "<matched-route>", 160)
    : String(pathname || "").startsWith("/api/") ? "<api-pre-route>" : "<non-api-request>";
  const cause = error?.cause || error;
  const causeName = boundedToken(cause?.name, "Error", 40);
  const causeCode = boundedToken(cause?.code, "", 40);
  return {
    method: boundedToken(method, "?", 16),
    route,
    cause: `${causeName}${causeCode ? `/${causeCode}` : ""}`,
  };
}
