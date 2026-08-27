import { LIMITS, clean } from "./validation.mjs";

export const SUGGESTION_BODY_LIMIT = LIMITS.message;

export const SUGGESTION_CATEGORIES = Object.freeze([
  Object.freeze({ key: "friction", label: "Something felt confusing", shortLabel: "Confusing" }),
  Object.freeze({ key: "idea", label: "I have an idea", shortLabel: "Idea" }),
  Object.freeze({ key: "bug", label: "Something did not work", shortLabel: "Bug" }),
  Object.freeze({ key: "other", label: "Something else", shortLabel: "Other" }),
]);

// A surface is intentionally categorical. Never accept a URL, route parameter,
// search term, artist name, or other potentially identifying page context.
export const SUGGESTION_SAFE_SURFACES = Object.freeze([
  "landing",
  "feed",
  "search",
  "discover",
  "you",
  "artist",
  "profile",
  "settings",
  "menu",
  "other",
]);

export const SUGGESTION_STATUSES = Object.freeze([
  "new",
  "considering",
  "planned",
  "shipped",
  "closed",
]);

const CATEGORY_KEYS = new Set(SUGGESTION_CATEGORIES.map((category) => category.key));
const SAFE_SURFACES = new Set(SUGGESTION_SAFE_SURFACES);
const STATUSES = new Set(SUGGESTION_STATUSES);
const CLIENT_MUTATION_ID = /^sgc_[a-z0-9_-]{12,76}$/;
const SUGGESTION_ID = /^sg_[A-Za-z0-9_-]{2,116}$/;

const normalizedEnum = (value, allowed) => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return allowed.has(normalized) ? normalized : null;
};

export const normalizeSuggestionCategory = (value) => normalizedEnum(value, CATEGORY_KEYS);
export const normalizeSuggestionSurface = (value) => normalizedEnum(value, SAFE_SURFACES);
export const normalizeSuggestionStatus = (value) => normalizedEnum(value, STATUSES);

export function cleanSuggestionBody(value) {
  return clean(value, { max: SUGGESTION_BODY_LIMIT, newlines: true });
}

export function isSuggestionClientMutationId(value) {
  return typeof value === "string" && CLIENT_MUTATION_ID.test(value);
}

function randomToken({ random = Math.random, uuid } = {}) {
  const generatedUuid = typeof uuid === "string"
    ? uuid
    : typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : "";
  if (generatedUuid) return generatedUuid.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 32);
  const numeric = typeof random === "function" ? Number(random()) : Number.NaN;
  const safe = Number.isFinite(numeric) ? Math.max(0, Math.min(0.9999999999999999, numeric)) : 0.5;
  return Math.floor(safe * Number.MAX_SAFE_INTEGER).toString(36).padStart(11, "0");
}

export function createSuggestionClientMutationId({ now = Date.now(), random = Math.random, uuid } = {}) {
  const at = Math.max(0, Math.trunc(Number(now) || 0)).toString(36);
  return `sgc_${at}_${randomToken({ random, uuid })}`.slice(0, 80);
}

export function parseSuggestionSubmission(input) {
  const category = normalizeSuggestionCategory(input?.category);
  if (!category) return { valid: false, field: "category", message: "Choose what kind of suggestion this is." };

  const body = cleanSuggestionBody(input?.body);
  if (body.length < 3) return { valid: false, field: "body", message: "Tell us a little more before sending." };

  const clientMutationId = typeof input?.clientMutationId === "string" ? input.clientMutationId.trim() : "";
  if (!isSuggestionClientMutationId(clientMutationId)) {
    return { valid: false, field: "clientMutationId", message: "This suggestion is not ready to send. Try again." };
  }

  let surface = null;
  if (input?.surface != null && input.surface !== "") {
    surface = normalizeSuggestionSurface(input.surface);
    if (!surface) return { valid: false, field: "surface", message: "That page context cannot be included." };
  }

  // This explicit projection is the privacy boundary: extra caller fields such
  // as email, userId, URL, query text, or user-agent can never enter the request.
  const payload = { category, body, clientMutationId };
  if (surface) payload.surface = surface;
  return { valid: true, payload };
}

export function suggestionFailureMessage(error) {
  if (error?.name === "SuggestionValidationError" && typeof error?.message === "string") {
    return clean(error.message, { max: 180 }) || "Check the suggestion and try again.";
  }
  if (error?.name === "SuggestionConfirmationError") {
    return "Pit did not confirm that suggestion. Try again.";
  }
  if (error?.serverCode === "RATE_LIMITED" || Number(error?.status) === 429) {
    return "You have sent several suggestions recently. Give it a little time, then try again.";
  }
  if (error?.serverCode === "VALIDATION_FAILED" && typeof error?.message === "string") {
    const message = clean(error.message, { max: 180 });
    if (message) return message;
  }
  return "Your suggestion was not sent. Check your connection and try again.";
}

export function parseSuggestionConfirmation(response, clientMutationId) {
  const id = typeof response?.id === "string" ? response.id.trim() : "";
  if (!SUGGESTION_ID.test(id) || !isSuggestionClientMutationId(clientMutationId)) return null;
  return {
    id,
    reference: id.slice(-8).toUpperCase(),
    duplicate: response?.duplicate === true,
    clientMutationId,
  };
}

export function isSuggestionId(value) {
  return typeof value === "string" && SUGGESTION_ID.test(value.trim());
}
