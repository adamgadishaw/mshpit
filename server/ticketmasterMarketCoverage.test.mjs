import assert from "node:assert/strict";
import test from "node:test";
import {
  collectTicketmasterPartitionedMarket,
  normalizeTicketmasterMarketCoverageState,
  ticketmasterMarketCoverageKey,
  ticketmasterMarketCoverageWindow,
} from "./ticketmasterMarketCoverage.js";

const NOW = Date.parse("2026-08-28T12:00:00Z");

function response({ page = 0, totalPages = 1, totalElements = 1, ids = [] } = {}) {
  return {
    page: { number: page, totalPages, totalElements },
    _embedded: { events: ids.map((id) => ({ id })) },
  };
}

function collectorOptions(overrides = {}) {
  return {
    now: NOW,
    buildUrl: (request) => request,
    rowsFromResponse: (data) => (data?._embedded?.events || []).map((event) => ({
      id: `tm_${event.id}`,
      provider_event_id: event.id,
    })),
    wait: async () => {},
    ...overrides,
  };
}

test("market keys are stable without leaking arbitrary punctuation", () => {
  assert.equal(ticketmasterMarketCoverageKey({ countryCode: " pt " }), "country:PT");
  assert.equal(ticketmasterMarketCoverageKey({ city: " Sao Paulo! " }), "city:sao-paulo");
  assert.equal(ticketmasterMarketCoverageKey({ city: "" }), null);
});

test("coverage state rejects expired cursors and bounds the rolling UTC window", () => {
  const state = normalizeTicketmasterMarketCoverageState({
    cursorDate: "2026-08-01",
    windowDays: 999,
    gaps: [
      { startDate: "2026-08-01", throughDate: "2026-08-02", reason: "provider-deep-page-limit" },
      { startDate: "2026-09-01", throughDate: "2026-09-01", reason: "provider-deep-page-limit", observedTotal: 1200 },
    ],
  }, { now: NOW, horizonDays: 30, defaultWindowDays: 7 });
  assert.equal(state.cursorDate, "2026-08-28");
  assert.equal(state.windowDays, 7);
  assert.deepEqual(state.gaps, [{
    startDate: "2026-09-01",
    throughDate: "2026-09-01",
    reason: "provider-deep-page-limit",
    observedTotal: 1200,
  }]);

  assert.deepEqual(ticketmasterMarketCoverageWindow(state, {
    now: NOW,
    horizonDays: 30,
    defaultWindowDays: 7,
  }), {
    state,
    today: "2026-08-28",
    horizonThrough: "2026-09-26",
    startDate: "2026-08-28",
    throughDate: "2026-09-03",
    spanDays: 7,
    startDateTime: "2026-08-28T00:00:00Z",
    endDateTime: "2026-09-03T23:59:59Z",
  });
});

test("sparse markets cover and account for an entire horizon within a bounded budget", async () => {
  const calls = [];
  const result = await collectTicketmasterPartitionedMarket(collectorOptions({
    horizonDays: 14,
    defaultWindowDays: 7,
    maxRequests: 2,
    fetchJson: async (request) => {
      calls.push(request);
      return response({ ids: [request.startDateTime.slice(0, 10)] });
    },
  }));

  assert.equal(result.complete, false, "a market slice cannot authorize source-wide stale cleanup");
  assert.equal(result.requestComplete, true);
  assert.equal(result.cycleComplete, true);
  assert.equal(result.coverageComplete, true);
  assert.equal(result.requestsUsed, 2);
  assert.equal(result.budgetExhausted, false);
  assert.deepEqual(calls.map(({ startDateTime, endDateTime, page }) => ({ startDateTime, endDateTime, page })), [
    { startDateTime: "2026-08-28T00:00:00Z", endDateTime: "2026-09-03T23:59:59Z", page: 0 },
    { startDateTime: "2026-09-04T00:00:00Z", endDateTime: "2026-09-10T23:59:59Z", page: 0 },
  ]);
  assert.deepEqual(result.coveredWindows.map(({ startDate, throughDate }) => ({ startDate, throughDate })), [
    { startDate: "2026-08-28", throughDate: "2026-09-03" },
    { startDate: "2026-09-04", throughDate: "2026-09-10" },
  ]);
  assert.equal(result.nextState.cursorDate, "2026-08-28", "a completed cycle restarts at the moving near-term horizon");
  assert.equal(result.nextState.lastCompleteThrough, "2026-09-10");
});

test("persisted progress resumes at the next unscanned date", async () => {
  const calls = [];
  const result = await collectTicketmasterPartitionedMarket(collectorOptions({
    state: { cursorDate: "2026-09-04", windowDays: 7, cycleStartedDate: "2026-08-28" },
    horizonDays: 30,
    maxRequests: 1,
    fetchJson: async (request) => {
      calls.push(request);
      return response({ ids: ["resumed"] });
    },
  }));
  assert.equal(calls[0].startDateTime, "2026-09-04T00:00:00Z");
  assert.equal(result.nextState.cursorDate, "2026-09-11");
  assert.equal(result.budgetExhausted, true);
});

test("dense windows shrink before paging and preserve request pacing", async () => {
  const calls = [];
  const waits = [];
  const result = await collectTicketmasterPartitionedMarket(collectorOptions({
    horizonDays: 30,
    defaultWindowDays: 7,
    maxRequests: 4,
    requestDelayMs: 1,
    wait: async (delay) => { waits.push(delay); },
    fetchJson: async (request) => {
      calls.push(request);
      const isWide = request.endDateTime.startsWith("2026-09-03");
      return isWide
        ? response({ page: request.page, totalPages: 7, totalElements: 1400, ids: [`wide-${request.page}`] })
        : response({ page: request.page, totalPages: 3, totalElements: 600, ids: [`narrow-${request.page}`] });
    },
  }));

  assert.deepEqual(calls.map(({ endDateTime, page }) => ({ endDateTime, page })), [
    { endDateTime: "2026-09-03T23:59:59Z", page: 0 },
    { endDateTime: "2026-08-30T23:59:59Z", page: 0 },
    { endDateTime: "2026-08-30T23:59:59Z", page: 1 },
    { endDateTime: "2026-08-30T23:59:59Z", page: 2 },
  ]);
  assert.deepEqual(waits, [500, 500, 500], "even an unsafe low override remains at or below two requests per second");
  assert.equal(result.nextState.cursorDate, "2026-08-31");
  assert.equal(result.nextState.windowDays, 3);
  assert.equal(result.coveredThrough, "2026-08-30");
  assert.equal(result.requestsUsed, 4);
});

test("a one-day provider overflow records a gap and continues with later dates", async () => {
  const result = await collectTicketmasterPartitionedMarket(collectorOptions({
    horizonDays: 3,
    defaultWindowDays: 1,
    maxRequests: 6,
    fetchJson: async (request) => {
      if (request.startDateTime.startsWith("2026-08-28")) {
        return response({ page: request.page, totalPages: 6, totalElements: 1200, ids: [`overflow-${request.page}`] });
      }
      return response({ ids: ["later-date"] });
    },
  }));

  assert.equal(result.blockedAtOneDay, true);
  assert.equal(result.coverageComplete, false);
  assert.equal(result.requestComplete, true);
  assert.equal(result.nextState.cursorDate, "2026-08-30", "the impossible day does not permanently block the market");
  assert.deepEqual(result.nextState.gaps, [{
    startDate: "2026-08-28",
    throughDate: "2026-08-28",
    reason: "provider-deep-page-limit",
    observedTotal: 1200,
  }]);
  assert.ok(result.rows.some((row) => row.provider_event_id === "later-date"));
});

test("exactly 1,000 results remain pageable without a false coverage gap", async () => {
  const result = await collectTicketmasterPartitionedMarket(collectorOptions({
    horizonDays: 1,
    defaultWindowDays: 1,
    maxRequests: 5,
    fetchJson: async (request) => response({
      page: request.page,
      totalPages: 5,
      totalElements: 1000,
      ids: [`page-${request.page}`],
    }),
  }));
  assert.equal(result.requestsUsed, 5);
  assert.equal(result.cycleComplete, true);
  assert.equal(result.coverageComplete, true);
  assert.equal(result.blockedAtOneDay, false);
  assert.deepEqual(result.nextState.gaps, []);
});

test("budget exhaustion keeps rows but leaves the unfinished window at its start", async () => {
  const result = await collectTicketmasterPartitionedMarket(collectorOptions({
    horizonDays: 7,
    maxRequests: 2,
    fetchJson: async (request) => response({
      page: request.page,
      totalPages: 3,
      totalElements: 500,
      ids: [`partial-${request.page}`],
    }),
  }));
  assert.equal(result.requestComplete, true);
  assert.equal(result.complete, false);
  assert.equal(result.budgetExhausted, true);
  assert.equal(result.nextState.cursorDate, "2026-08-28");
  assert.deepEqual(result.rows.map((row) => row.provider_event_id), ["partial-0", "partial-1"]);
  assert.deepEqual(result.coveredWindows, []);
});

test("five full pages without pagination totals keep the market cursor fail-closed", async () => {
  const pages = [];
  const result = await collectTicketmasterPartitionedMarket(collectorOptions({
    horizonDays: 7,
    defaultWindowDays: 7,
    maxRequests: 10,
    fetchJson: async (request) => {
      pages.push(request.page);
      return {
        _embedded: {
          events: Array.from({ length: 200 }, (_, index) => ({
            id: `page-${request.page}-event-${index}`,
          })),
        },
      };
    },
  }));
  assert.deepEqual(pages, [0, 1, 2, 3, 4]);
  assert.equal(result.requestComplete, true, "all attempted HTTP requests succeeded");
  assert.equal(result.paginationUnproven, true);
  assert.equal(result.cycleComplete, false);
  assert.equal(result.nextState.cursorDate, "2026-08-28");
  assert.deepEqual(result.coveredWindows, [],
    "unknown page six cannot be represented as verified date coverage");
});

test("a later page failure keeps verified rows and does not advance coverage", async () => {
  const failure = new Error("provider page failed");
  const result = await collectTicketmasterPartitionedMarket(collectorOptions({
    horizonDays: 14,
    maxRequests: 10,
    fetchJson: async (request) => {
      if (request.page === 1) throw failure;
      return response({ page: 0, totalPages: 2, totalElements: 250, ids: ["verified-first-page"] });
    },
  }));

  assert.equal(result.complete, false);
  assert.equal(result.requestComplete, false);
  assert.equal(result.error, failure);
  assert.equal(result.requestsUsed, 2, "failed outbound requests are still charged to the provider budget");
  assert.deepEqual(result.rows.map((row) => row.provider_event_id), ["verified-first-page"]);
  assert.equal(result.nextState.cursorDate, "2026-08-28");
  assert.deepEqual(result.coveredWindows, []);
});

test("a later successful cycle clears a previously recorded one-day gap", async () => {
  const result = await collectTicketmasterPartitionedMarket(collectorOptions({
    state: {
      cursorDate: "2026-08-28",
      windowDays: 1,
      cycleStartedDate: "2026-08-28",
      gaps: [{
        startDate: "2026-08-28",
        throughDate: "2026-08-28",
        reason: "provider-deep-page-limit",
        observedTotal: 1100,
      }],
    },
    horizonDays: 1,
    defaultWindowDays: 1,
    maxRequests: 1,
    fetchJson: async () => response({ totalElements: 20, ids: ["now-pageable"] }),
  }));
  assert.equal(result.cycleComplete, true);
  assert.equal(result.coverageComplete, true);
  assert.deepEqual(result.nextState.gaps, []);
  assert.equal(result.nextState.lastCompleteThrough, "2026-08-28");
});
