import { api } from "../../lib/api";
import {
  DISCOVER_RANGE_MAX_EVENTS,
  discoverySidebarRangeRequestPath,
  parseTourDateRangeResponse,
  tourDateRangeRequestPath,
} from "../../domain/discoverEventRange.mjs";

export async function fetchDiscoverTourDateRange({ days, limit, after, country, local = false, signal } = {}) {
  const path = local
    ? discoverySidebarRangeRequestPath({ days, limit: DISCOVER_RANGE_MAX_EVENTS })
    : tourDateRangeRequestPath({ days, limit, after, country });
  const payload = await api(path, {
    signal,
    silent: true,
    context: "Loading more upcoming events",
  });
  return parseTourDateRangeResponse(payload);
}

export async function fetchStartupTourDates({ signal, expectedAccountId } = {}) {
  const payload = await api(tourDateRangeRequestPath({ days: 30, limit: DISCOVER_RANGE_MAX_EVENTS }), {
    signal,
    silent: true,
    context: "Loading tour dates",
    expectedAccountId,
  });
  return parseTourDateRangeResponse(payload);
}
