import { api } from "../../lib/api";
import {
  DISCOVER_RANGE_MAX_EVENTS,
  discoverySidebarRangeRequestPath,
  mergeStartupTourDatePages,
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

export async function fetchStartupTourDates({ signal, expectedAccountId, homeCountry } = {}) {
  const globalPath = tourDateRangeRequestPath({ days: 30, limit: DISCOVER_RANGE_MAX_EVENTS });
  const homePath = tourDateRangeRequestPath({
    days: 30,
    limit: DISCOVER_RANGE_MAX_EVENTS,
    country: homeCountry,
  });
  const paths = homePath === globalPath ? [globalPath] : [globalPath, homePath];
  // Country inventory is additive and fail-soft. A provider/network failure in
  // either request must not erase the other usable snapshot.
  const settled = await Promise.allSettled(paths.map((path, index) => api(path, {
    signal,
    silent: true,
    context: index === 0 ? "Loading tour dates" : "Loading concerts near home",
    expectedAccountId,
  })));
  const successful = settled
    .filter((result) => result.status === "fulfilled")
    .map((result) => parseTourDateRangeResponse(result.value));
  if (!successful.length) throw settled[0].reason;
  return {
    tourDates: mergeStartupTourDatePages(successful.map((page) => page.tourDates)),
    nextCursor: successful[0]?.nextCursor || null,
    through: successful[0]?.through || successful[1]?.through || null,
    partial: successful.length < paths.length,
  };
}
