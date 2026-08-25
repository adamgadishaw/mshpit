import {
  SUGGESTION_STATUSES,
  isSuggestionId,
  parseSuggestionSubmission,
} from "../../../src/domain/suggestionBox.mjs";
import { suggestionRetentionCutoffs } from "./suggestionRetention.js";

const TERMINAL_STATUSES = new Set(["shipped", "closed"]);
const STATUS_SET = new Set(SUGGESTION_STATUSES);

const timestamp = (value) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new TypeError("Suggestions require a valid timestamp");
  return parsed;
};

const sameSubmission = (row, payload) => row
  && row.category === payload.category
  && row.body === payload.body
  && (row.surface || null) === (payload.surface || null);

function suggestionProjection(row) {
  return {
    id: row.id,
    category: row.category,
    body: row.body,
    surface: row.surface || null,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at ?? null,
  };
}

export function encodeSuggestionCursor(row) {
  if (!row || !isSuggestionId(row.id) || !Number.isSafeInteger(Number(row.created_at))) return null;
  return Buffer.from(JSON.stringify([Number(row.created_at), row.id]), "utf8").toString("base64url");
}

export function decodeSuggestionCursor(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{4,240}$/u.test(value)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [createdAt, id] = parsed;
    if (!Number.isSafeInteger(createdAt) || createdAt < 0 || !isSuggestionId(id)) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

export function createSuggestionService({ repository, createId }) {
  if (!repository?.findById || !repository?.findByMutationId || !repository?.insertSuggestion
    || !repository?.listSuggestions || !repository?.updateStatus || !repository?.prune
    || typeof repository.transaction !== "function" || typeof createId !== "function") {
    throw new TypeError("Product suggestions require complete service dependencies");
  }

  const prune = (at) => repository.prune(suggestionRetentionCutoffs(at));

  return Object.freeze({
    submit(input, { at }) {
      const submittedAt = timestamp(at);
      const parsed = parseSuggestionSubmission(input);
      if (!parsed.valid) {
        return {
          ok: false,
          validation: true,
          field: parsed.field,
          message: parsed.message,
        };
      }
      prune(submittedAt);

      const existing = repository.findByMutationId(parsed.payload.clientMutationId);
      if (existing) {
        return sameSubmission(existing, parsed.payload)
          ? { ok: true, id: existing.id, duplicate: true }
          : { ok: false, mismatch: true };
      }

      const id = createId("sg");
      if (!isSuggestionId(id)) throw new TypeError("Suggestion id generation failed");
      const result = repository.insertSuggestion({
        id,
        clientMutationId: parsed.payload.clientMutationId,
        category: parsed.payload.category,
        body: parsed.payload.body,
        surface: parsed.payload.surface || null,
        at: submittedAt,
      });
      if (!result.row) throw new Error("Suggestion persistence failed");
      if (!result.inserted && !sameSubmission(result.row, parsed.payload)) {
        return { ok: false, mismatch: true };
      }
      return { ok: true, id: result.row.id, duplicate: !result.inserted };
    },

    list({ status = null, category = null, before = null, limit = 50, at }) {
      const readAt = timestamp(at);
      prune(readAt);
      const boundedLimit = Math.max(1, Math.min(100, Math.trunc(Number(limit) || 50)));
      const rows = repository.listSuggestions({
        status,
        category,
        before,
        limit: boundedLimit + 1,
      });
      const hasMore = rows.length > boundedLimit;
      const page = hasMore ? rows.slice(0, boundedLimit) : rows;
      return {
        suggestions: page.map(suggestionProjection),
        nextCursor: hasMore ? encodeSuggestionCursor(page.at(-1)) : null,
        hasMore,
      };
    },

    updateStatus({ id, status, at, audit }) {
      const updatedAt = timestamp(at);
      if (!isSuggestionId(id) || !STATUS_SET.has(status)) return null;
      prune(updatedAt);
      return repository.transaction(() => {
        const previous = repository.findById(id);
        if (!previous) return null;
        if (previous.status === status) {
          return { suggestion: suggestionProjection(previous), changed: false };
        }
        const closedAt = TERMINAL_STATUSES.has(status)
          ? (previous.closed_at ?? updatedAt)
          : null;
        const next = repository.updateStatus({ id, status, updatedAt, closedAt });
        if (!next) return null;
        if (typeof audit === "function") {
          audit({ id, previousStatus: previous.status, status });
        }
        return { suggestion: suggestionProjection(next), changed: true };
      });
    },
  });
}
