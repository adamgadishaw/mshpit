import {
  isSuggestionId,
  normalizeSuggestionCategory,
  normalizeSuggestionStatus,
  parseSuggestionConfirmation,
  parseSuggestionSubmission,
} from "../../domain/suggestionBox.mjs";

const requireApiCall = (apiCall) => {
  if (typeof apiCall !== "function") throw new TypeError("A PIT API caller is required.");
  return apiCall;
};

export async function submitSuggestion(input, { apiCall } = {}) {
  const parsed = parseSuggestionSubmission(input);
  if (!parsed.valid) {
    const error = new Error(parsed.message);
    error.name = "SuggestionValidationError";
    error.field = parsed.field;
    throw error;
  }
  const call = requireApiCall(apiCall);
  const response = await call("/api/suggestions", {
    method: "POST",
    body: parsed.payload,
    context: "Sending anonymous product feedback",
    silent: true,
  });
  const confirmation = parseSuggestionConfirmation(response, parsed.payload.clientMutationId);
  if (!confirmation) {
    const error = new Error("The server response did not confirm a durable suggestion.");
    error.name = "SuggestionConfirmationError";
    throw error;
  }
  return confirmation;
}

export function listSuggestions({ status, category, before, limit = 50, signal } = {}, { apiCall } = {}) {
  const call = requireApiCall(apiCall);
  const params = new URLSearchParams();
  const safeStatus = normalizeSuggestionStatus(status);
  const safeCategory = normalizeSuggestionCategory(category);
  if (safeStatus) params.set("status", safeStatus);
  if (safeCategory) params.set("category", safeCategory);
  if (typeof before === "string" && /^[A-Za-z0-9_-]{4,240}$/.test(before)) params.set("before", before);
  const boundedLimit = Math.max(1, Math.min(100, Math.trunc(Number(limit) || 50)));
  params.set("limit", String(boundedLimit));
  return call(`/api/admin/suggestions?${params.toString()}`, {
    signal,
    silent: true,
    context: "Loading product suggestions",
  });
}

export function updateSuggestionStatus(id, status, { apiCall } = {}) {
  const call = requireApiCall(apiCall);
  const suggestionId = typeof id === "string" ? id.trim() : "";
  const safeStatus = normalizeSuggestionStatus(status);
  if (!isSuggestionId(suggestionId)) throw new TypeError("A valid suggestion ID is required.");
  if (!safeStatus) throw new TypeError("A valid suggestion status is required.");
  return call(`/api/admin/suggestions/${encodeURIComponent(suggestionId)}`, {
    method: "PATCH",
    body: { status: safeStatus },
    silent: true,
    context: "Updating a product suggestion",
  });
}
