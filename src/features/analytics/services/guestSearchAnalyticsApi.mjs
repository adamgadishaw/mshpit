import { api } from "../../../lib/api";
import { sanitizeGuestSearchPayload } from "../../../domain/guestSearchAnalytics.mjs";

export const GUEST_SEARCH_ANALYTICS_PATH = "/api/analytics/guest-search";

// Guest measurement is intentionally best-effort: it never owns a durable
// queue, retries, or a visitor identifier, and its failure cannot block search.
// `request` is injectable for a focused unit test without loading React Native.
export async function recordGuestSearch(payload, { signal, request = api } = {}) {
  const body = sanitizeGuestSearchPayload(payload);
  if (!body) return false;

  try {
    await request(GUEST_SEARCH_ANALYTICS_PATH, {
      method: "POST",
      body,
      signal,
      silent: true,
      context: "Counting a guest search",
      // Bind the write to the guest state observed by this tab. If a shared
      // browser cookie becomes signed in before delivery, the API identity
      // boundary rejects it instead of misclassifying member activity.
      expectedAccountId: null,
    });
    return true;
  } catch { // architecture: allow-ambiguous-result -- optional guest metrics never become product failures
    // architecture: allow-empty-catch -- aggregate guest measurement is
    // deliberately best-effort and must never become a search failure.
    return false;
  }
}
