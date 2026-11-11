import { creatorUpdateDraft } from "./creatorUpdateDraft.mjs";

export const POST_CREATE_RETRY_DELAYS_MS = Object.freeze([250, 900]);
export const POST_CREATE_ATTEMPT_TIMEOUT_MS = 12_000;

export function shouldRetryPostCreate(error) {
  const status = Number(error?.status) || 0;
  if (status === 429 || status === 401 || status === 403) return false;
  return status === 0 || status === 408 || status === 425 || status >= 500;
}

const waitFor = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));

// One immutable payload and one client mutation id are reused for every
// attempt. The server owns exactly-once reconciliation, so a response lost
// after commit cannot create a second post when this function tries again.
export async function deliverPostCreate({
  apiCall,
  body,
  context,
  expectedAccountId,
  retryDelaysMs = POST_CREATE_RETRY_DELAYS_MS,
  wait = waitFor,
} = {}) {
  if (typeof apiCall !== "function") throw new TypeError("Post delivery requires an API client");
  if (!body?.clientMutationId) throw new TypeError("Post delivery requires a stable mutation id");
  const delays = Array.isArray(retryDelaysMs)
    ? retryDelaysMs.filter((value) => Number.isFinite(Number(value)) && Number(value) >= 0).slice(0, 4)
    : POST_CREATE_RETRY_DELAYS_MS;

  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await apiCall("/api/posts", {
        method: "POST",
        body,
        context,
        expectedAccountId,
        timeoutMs: POST_CREATE_ATTEMPT_TIMEOUT_MS,
        // The composer owns the single final error message. Intermediate
        // attempts remain in Diagnostics but never produce duplicate toasts.
        silent: true,
      });
      if (body.creatorUpdate) {
        const expected = creatorUpdateDraft(body.creatorUpdate);
        if (!response?.post?.id || response.id !== response.post.id || !expected
          || Object.entries(expected).some(([key, value]) => response.post.creatorUpdate?.[key] !== value)) {
          throw new Error("The page update could not be confirmed. Your draft is saved; retry before starting another post.");
        }
      }
      return response;
    } catch (error) {
      if (attempt >= delays.length || !shouldRetryPostCreate(error)) throw error;
      await wait(delays[attempt]);
    }
  }
}
