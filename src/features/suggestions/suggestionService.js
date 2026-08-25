import { api } from "../../lib/api";
import {
  listSuggestions as listSuggestionsWithApi,
  submitSuggestion as submitSuggestionWithApi,
  updateSuggestionStatus as updateSuggestionStatusWithApi,
} from "./suggestionApi.mjs";

// The feature service owns PIT transport. Screens consume named operations and
// never reach into the shared api() adapter directly.
export const submitSuggestion = (input) => submitSuggestionWithApi(input, { apiCall: api });

export const listSuggestions = (options) => listSuggestionsWithApi(options, { apiCall: api });

export const updateSuggestionStatus = (id, status) => updateSuggestionStatusWithApi(id, status, { apiCall: api });
