import assert from "node:assert/strict";
import test from "node:test";

import { listSuggestions, submitSuggestion, updateSuggestionStatus } from "./suggestionApi.mjs";

const VALID = {
  category: "idea",
  body: "Let me invite friends to a show.",
  surface: "artist",
  clientMutationId: "sgc_myk1pzpc_123e4567e89b12d3a456426614174000",
};

test("submitSuggestion sends only the anonymous parsed payload", async () => {
  const calls = [];
  const result = await submitSuggestion({
    ...VALID,
    email: "not-sent@example.com",
    accountId: "u_not_sent",
    url: "https://www.mshpit.com/private",
  }, {
    apiCall: async (...args) => {
      calls.push(args);
      return { id: "sg_server_12345678" };
    },
  });
  assert.equal(result.reference, "12345678");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "/api/suggestions");
  assert.deepEqual(calls[0][1], {
    method: "POST",
    body: VALID,
    context: "Sending anonymous product feedback",
    silent: true,
  });
});

test("submitSuggestion does not call the network for invalid input", async () => {
  let calls = 0;
  await assert.rejects(
    submitSuggestion({ ...VALID, body: "x" }, { apiCall: async () => { calls += 1; } }),
    (error) => error?.name === "SuggestionValidationError" && error?.field === "body",
  );
  assert.equal(calls, 0);
});

test("submitSuggestion requires durable server confirmation and keeps transport text private", async () => {
  await assert.rejects(
    submitSuggestion(VALID, { apiCall: async () => ({ accepted: true }) }),
    (error) => error?.name === "SuggestionConfirmationError",
  );
  await assert.rejects(
    submitSuggestion(VALID, { apiCall: async () => { throw new Error("private database path"); } }),
    /private database path/,
  );
});

test("listSuggestions builds a bounded, categorical admin query", async () => {
  const calls = [];
  const signal = new AbortController().signal;
  await listSuggestions({ status: "planned", category: "idea", before: "cursor_123", limit: 900, signal }, {
    apiCall: (...args) => { calls.push(args); return Promise.resolve({ suggestions: [] }); },
  });
  assert.equal(calls[0][0], "/api/admin/suggestions?status=planned&category=idea&before=cursor_123&limit=100");
  assert.equal(calls[0][1].signal, signal);
  assert.equal(calls[0][1].context, "Loading product suggestions");
});

test("updateSuggestionStatus validates both path identity and desired state", async () => {
  const calls = [];
  await updateSuggestionStatus("sg_server_123", "shipped", { apiCall: (...args) => { calls.push(args); return Promise.resolve({ ok: true }); } });
  assert.deepEqual(calls[0], [
    "/api/admin/suggestions/sg_server_123",
    { method: "PATCH", body: { status: "shipped" }, silent: true, context: "Updating a product suggestion" },
  ]);
  assert.throws(() => updateSuggestionStatus("../users", "planned", { apiCall: async () => ({}) }), /valid suggestion ID/i);
  assert.throws(() => updateSuggestionStatus("sg_server_123", "deleted", { apiCall: async () => ({}) }), /valid suggestion status/i);
});
