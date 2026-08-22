import { toIsoDate, isValidDate } from "../src/domain/dates.mjs";
import {
  LIMITS,
  clampRating,
  clean,
  cleanEmail,
  cleanHandle,
  cleanName,
  isEmail,
  isHandle,
  isName,
  isPassword,
} from "../src/domain/validation.mjs";

// Server routes remain the trust boundary; the normalization policy itself is
// pure and shared so client reconciliation cannot drift from server acceptance.
export {
  LIMITS,
  clampRating,
  clean,
  cleanEmail,
  cleanHandle,
  cleanName,
  isEmail,
  isHandle,
  isName,
  isPassword,
};

// Performance dates are stored ISO and formatted at display time; see
// src/domain/dates.mjs for why that identity matters. Accepts any shape the
// product has ever written and canonicalizes it, so the same night always
// produces the same performance no matter which client wrote it.
export const isDate = isValidDate;

// Returns the canonical ISO date, or undefined so `shape()` reports it invalid.
export const cleanDate = (s) => toIsoDate(clean(s, { max: LIMITS.date })) || undefined;

// Bounded string array (photos, setlist, genres…): every item cleaned + capped.
export function cleanStringArray(v, { maxItems = 20, maxLen = 300 } = {}) {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === "string").map((x) => clean(x, { max: maxLen })).filter(Boolean).slice(0, maxItems);
}

// Route-level schema check: { field: (value) => cleanedValue | undefined }.
// Returns [errors, cleaned]. Unknown fields are DROPPED (never passed through).
export function shape(body, spec) {
  const errors = [];
  const out = {};
  for (const [key, rule] of Object.entries(spec)) {
    const { required = false, parse } = rule;
    const raw = body?.[key];
    if (raw === undefined || raw === null || raw === "") {
      if (required) errors.push(`${key} is required`);
      continue;
    }
    const val = parse(raw);
    if (val === undefined) errors.push(`${key} is invalid`);
    else out[key] = val;
  }
  return [errors, out];
}
