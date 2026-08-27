import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  SUGGESTION_BODY_LIMIT,
  SUGGESTION_CATEGORIES,
  SUGGESTION_SAFE_SURFACES,
  SUGGESTION_STATUSES,
  cleanSuggestionBody,
  createSuggestionClientMutationId,
  isSuggestionClientMutationId,
  normalizeSuggestionCategory,
  normalizeSuggestionStatus,
  normalizeSuggestionSurface,
  parseSuggestionConfirmation,
  parseSuggestionSubmission,
  suggestionFailureMessage,
} from "./suggestionBox.mjs";

test("suggestion enums accept only bounded categorical values", () => {
  assert.deepEqual(SUGGESTION_CATEGORIES.map((category) => category.key), ["friction", "idea", "bug", "other"]);
  assert.ok(SUGGESTION_SAFE_SURFACES.includes("landing"));
  assert.equal(SUGGESTION_SAFE_SURFACES.includes("player"), false);
  assert.deepEqual(SUGGESTION_STATUSES, ["new", "considering", "planned", "shipped", "closed"]);
  assert.equal(normalizeSuggestionCategory(" IDEA "), "idea");
  assert.equal(normalizeSuggestionCategory("feature-request-with-email@example.com"), null);
  assert.equal(normalizeSuggestionSurface(" Search "), "search");
  assert.equal(normalizeSuggestionSurface("player"), null);
  assert.equal(normalizeSuggestionSurface("/search?q=private"), null);
  assert.equal(normalizeSuggestionStatus("Planned"), "planned");
  assert.equal(normalizeSuggestionStatus("deleted"), null);
});

test("suggestion body normalization preserves useful paragraphs and strips spoofing controls", () => {
  assert.equal(cleanSuggestionBody("  First\r\n\r\n\r\nSecond\u202e  "), "First\n\nSecond");
  assert.equal(cleanSuggestionBody("x".repeat(SUGGESTION_BODY_LIMIT + 40)).length, SUGGESTION_BODY_LIMIT);
});

test("client mutation IDs are deterministic when entropy is injected and pass the strict contract", () => {
  const id = createSuggestionClientMutationId({
    now: 1_800_000_000_000,
    uuid: "123e4567-e89b-12d3-a456-426614174000",
  });
  assert.equal(id, "sgc_mywpiww0_123e4567e89b12d3a456426614174000");
  assert.equal(isSuggestionClientMutationId(id), true);
  assert.equal(isSuggestionClientMutationId("post_unsafe"), false);
});

test("submission parsing projects exactly anonymous product-feedback fields", () => {
  const parsed = parseSuggestionSubmission({
    category: "idea",
    body: "Let fans pin favorite shows.",
    surface: "profile",
    clientMutationId: "sgc_myk1pzpc_123e4567e89b12d3a456426614174000",
    email: "private@example.com",
    userId: "u_private",
    ip: "203.0.113.1",
    url: "https://www.mshpit.com/profile/u_private?search=secret",
    searchText: "secret",
  });
  assert.deepEqual(parsed, {
    valid: true,
    payload: {
      category: "idea",
      body: "Let fans pin favorite shows.",
      clientMutationId: "sgc_myk1pzpc_123e4567e89b12d3a456426614174000",
      surface: "profile",
    },
  });
  assert.deepEqual(Object.keys(parsed.payload).sort(), ["body", "category", "clientMutationId", "surface"]);
});

test("submission parsing rejects incomplete or unsafe values", () => {
  assert.equal(parseSuggestionSubmission({}).field, "category");
  assert.equal(parseSuggestionSubmission({ category: "bug", body: "x", clientMutationId: "sgc_123456789012" }).field, "body");
  assert.equal(parseSuggestionSubmission({ category: "bug", body: "It broke", clientMutationId: "bad" }).field, "clientMutationId");
  assert.equal(parseSuggestionSubmission({ category: "bug", body: "It broke", clientMutationId: "sgc_123456789012", surface: "/users/123" }).field, "surface");
});

test("only a canonical server response becomes a confirmation", () => {
  const mutationId = "sgc_myk1pzpc_123e4567e89b12d3a456426614174000";
  assert.deepEqual(parseSuggestionConfirmation({ id: "sg_confirmed_12345678", duplicate: true }, mutationId), {
    id: "sg_confirmed_12345678",
    reference: "12345678",
    duplicate: true,
    clientMutationId: mutationId,
  });
  assert.equal(parseSuggestionConfirmation({ id: "locally invented" }, mutationId), null);
  assert.equal(parseSuggestionConfirmation({ id: "sg_confirmed_12345678" }, "bad"), null);
});

test("failure copy handles throttling without exposing arbitrary exception text", () => {
  assert.match(suggestionFailureMessage({ status: 429 }), /several suggestions/i);
  assert.equal(suggestionFailureMessage(new Error("sqlite password leaked")), "Your suggestion was not sent. Check your connection and try again.");
});

test("the suggestion screen keeps draft text in component memory only", () => {
  const screen = readFileSync(new URL("../screens/SuggestionBoxScreen.jsx", import.meta.url), "utf8");
  assert.match(screen, /export default function SuggestionBoxScreen\(\{ onClose, initialSurface = null \}\)/);
  assert.doesNotMatch(screen, /localStorage|AsyncStorage|SecureStore|\bsave\s*\(|\bload\s*\(/);
  assert.doesNotMatch(screen, /from ["']\.\.\/lib\/api/);
  assert.match(screen, /from ["']\.\.\/features\/suggestions\/suggestionService["']/);
});

test("the admin inbox presents anonymous notes without identity fields", () => {
  const inbox = readFileSync(new URL("../components/moderation/SuggestionInbox.jsx", import.meta.url), "utf8");
  assert.match(inbox, /No account or request metadata is attached/);
  assert.match(inbox, /asked not to include contact details/);
  assert.doesNotMatch(inbox, /item\?\.(?:email|userId|accountId|ip|userAgent)/);
});
