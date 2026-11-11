import { api } from "../../lib/api";
import { AppError } from "../../lib/diagnostics";
import { calendarShowsFromResponse, calendarShowsRequest } from "./calendarShowsRequest.mjs";

export const calendarShowsError = (error) => error instanceof AppError ? error : new AppError(undefined, {
  code: "PIT-API-001", context: "Loading calendar shows", source: "calendar-shows", cause: error,
});

export async function readCalendarShows(query, { after, limit, signal } = {}) {
  const request = calendarShowsRequest(query, { after, limit });
  const payload = await api(request.path, { signal, expectedAccountId: request.expectedAccountId,
    silent: true, context: "Loading calendar shows" });
  return calendarShowsFromResponse(payload, query, { limit: request.limit });
}
