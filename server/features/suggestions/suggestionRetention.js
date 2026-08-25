import { createSuggestionRepository } from "./suggestionRepository.js";

const DAY_MS = 24 * 60 * 60 * 1000;
export const SUGGESTION_CLOSED_RETENTION_MS = 90 * DAY_MS;
export const SUGGESTION_UNRESOLVED_RETENTION_MS = 365 * DAY_MS;

export function suggestionRetentionCutoffs(at = Date.now()) {
  const timestamp = Number(at);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new TypeError("Suggestion retention requires a valid timestamp");
  return {
    closedBefore: timestamp - SUGGESTION_CLOSED_RETENTION_MS,
    unresolvedBefore: timestamp - SUGGESTION_UNRESOLVED_RETENTION_MS,
  };
}

export function pruneProductSuggestions({ database, at = Date.now() } = {}) {
  return createSuggestionRepository(database).prune(suggestionRetentionCutoffs(at));
}
