const CRAWLER_FILE_WINDOW_MS = 60_000;
const CRAWLER_FILE_MAX_REQUESTS = 300;

function normalizedIp(ip) {
  const value = String(ip || "").trim();
  return value || "unknown";
}

export function crawlerFileRateLimitPolicy(ip) {
  return {
    key: `crawler-file:${normalizedIp(ip)}`,
    max: CRAWLER_FILE_MAX_REQUESTS,
    windowMs: CRAWLER_FILE_WINDOW_MS,
  };
}

export const crawlerFileRateLimitDefaults = Object.freeze({
  max: CRAWLER_FILE_MAX_REQUESTS,
  windowMs: CRAWLER_FILE_WINDOW_MS,
});
