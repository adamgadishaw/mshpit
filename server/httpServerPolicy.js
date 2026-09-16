// Bounds for connections that terminate at the Node API. User media bytes go
// directly to object storage, so API request bodies are small JSON and do not
// need upload-scale timeouts here.
export const HTTP_SERVER_LIMITS = Object.freeze({
  headersTimeout: 15_000,
  requestTimeout: 30_000,
  // Render may reuse an idle origin connection after Node's five-second
  // default. Keep completed requests reusable without relaxing the separate
  // header/body receive deadlines above. This does not mask deploy downtime.
  // https://render.com/docs/troubleshooting-deploys#runtime-errors
  keepAliveTimeout: 120_000,
  keepAliveTimeoutBuffer: 1_000,
  maxHeadersCount: 100,
  maxRequestsPerSocket: 100,
});

export function applyHttpServerLimits(server, limits = HTTP_SERVER_LIMITS) {
  for (const [property, value] of Object.entries(limits)) server[property] = value;
  return server;
}
