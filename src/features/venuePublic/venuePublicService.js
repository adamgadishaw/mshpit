import { api } from "../../lib/api";
import { AppError } from "../../lib/diagnostics";
import { fetchPublicVenueSnapshot as fetchSnapshot } from "./venuePublicApi.mjs";

export const fetchPublicVenueSnapshot = options => fetchSnapshot(options, {
  apiCall: api,
  invalidResponse: () => new AppError("Venue details could not be loaded. Please try again.", { kind: "invalid_response" }),
});
