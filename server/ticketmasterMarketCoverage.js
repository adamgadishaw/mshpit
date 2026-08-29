const DAY_MS = 24 * 60 * 60 * 1000;

export const TICKETMASTER_MARKET_HORIZON_DAYS = 90;
export const TICKETMASTER_MARKET_WINDOW_DAYS = 7;
export const TICKETMASTER_MARKET_REQUEST_BUDGET = 10;
export const TICKETMASTER_MARKET_PAGE_SIZE = 200;
export const TICKETMASTER_MARKET_MAX_PAGES = 5;
export const TICKETMASTER_MARKET_REQUEST_DELAY_MS = 550;

function boundedInteger(value, fallback, { min, max }) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function dateKey(value) {
  if (value == null || value === "") return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = Date.parse(`${value}T00:00:00Z`);
    if (Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value) return value;
  }
  const parsed = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

function shiftDate(value, days) {
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return new Date(parsed + days * DAY_MS).toISOString().slice(0, 10);
}

function daysBetween(from, through) {
  return Math.floor((Date.parse(`${through}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

function normalizeGap(value, today, horizonThrough) {
  const startDate = dateKey(value?.startDate);
  const throughDate = dateKey(value?.throughDate);
  if (!startDate || !throughDate || throughDate < today || startDate > horizonThrough || startDate > throughDate) return null;
  return {
    startDate,
    throughDate,
    reason: value?.reason === "provider-deep-page-limit" ? value.reason : "incomplete-provider-window",
    observedTotal: Number.isSafeInteger(Number(value?.observedTotal))
      ? Math.max(0, Number(value.observedTotal))
      : null,
  };
}

export function ticketmasterMarketCoverageKey({ city, countryCode } = {}) {
  const country = String(countryCode || "").trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(country)) return `country:${country}`;
  const cityKey = String(city || "")
    .normalize("NFKD")
    .replace(/\p{Mark}+/gu, "")
    .toLocaleLowerCase("en")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return cityKey ? `city:${cityKey}` : null;
}

export function normalizeTicketmasterMarketCoverageState(value, {
  now = Date.now(),
  horizonDays = TICKETMASTER_MARKET_HORIZON_DAYS,
  defaultWindowDays = TICKETMASTER_MARKET_WINDOW_DAYS,
} = {}) {
  let source = value;
  if (typeof source === "string") {
    try { source = JSON.parse(source); }
    catch { source = {}; }
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) source = {};

  const today = dateKey(now) || dateKey(Date.now());
  const days = boundedInteger(horizonDays, TICKETMASTER_MARKET_HORIZON_DAYS, { min: 1, max: 366 });
  const horizonThrough = shiftDate(today, days - 1);
  const preferredWindow = boundedInteger(defaultWindowDays, TICKETMASTER_MARKET_WINDOW_DAYS, { min: 1, max: 31 });
  const storedCursor = dateKey(source.cursorDate);
  const cursorDate = storedCursor && storedCursor >= today && storedCursor <= horizonThrough
    ? storedCursor
    : today;
  const windowDays = boundedInteger(source.windowDays, preferredWindow, { min: 1, max: preferredWindow });
  const gaps = (Array.isArray(source.gaps) ? source.gaps : [])
    .map((gap) => normalizeGap(gap, today, horizonThrough))
    .filter(Boolean)
    .slice(-366);

  return {
    version: 1,
    cursorDate,
    windowDays,
    cycleStartedDate: dateKey(source.cycleStartedDate) || today,
    lastCycleCompletedAt: source.lastCycleCompletedAt != null
      && Number.isSafeInteger(Number(source.lastCycleCompletedAt))
      ? Math.max(0, Number(source.lastCycleCompletedAt))
      : null,
    lastCompleteThrough: dateKey(source.lastCompleteThrough),
    gaps,
  };
}

export function ticketmasterMarketCoverageWindow(state, {
  now = Date.now(),
  horizonDays = TICKETMASTER_MARKET_HORIZON_DAYS,
  defaultWindowDays = TICKETMASTER_MARKET_WINDOW_DAYS,
} = {}) {
  const normalized = normalizeTicketmasterMarketCoverageState(state, { now, horizonDays, defaultWindowDays });
  const today = dateKey(now) || dateKey(Date.now());
  const days = boundedInteger(horizonDays, TICKETMASTER_MARKET_HORIZON_DAYS, { min: 1, max: 366 });
  const horizonThrough = shiftDate(today, days - 1);
  const remainingDays = daysBetween(normalized.cursorDate, horizonThrough) + 1;
  const spanDays = Math.max(1, Math.min(normalized.windowDays, remainingDays));
  const throughDate = shiftDate(normalized.cursorDate, spanDays - 1);
  return {
    state: normalized,
    today,
    horizonThrough,
    startDate: normalized.cursorDate,
    throughDate,
    spanDays,
    startDateTime: `${normalized.cursorDate}T00:00:00Z`,
    endDateTime: `${throughDate}T23:59:59Z`,
  };
}

function responseEvents(data) {
  return Array.isArray(data?._embedded?.events) ? data._embedded.events : [];
}

function responseTotals(data, pageSize) {
  const rawTotalElements = data?.page?.totalElements;
  const rawTotalPages = data?.page?.totalPages;
  const totalElements = rawTotalElements == null ? Number.NaN : Number(rawTotalElements);
  const totalPages = rawTotalPages == null ? Number.NaN : Number(rawTotalPages);
  const elements = Number.isSafeInteger(totalElements) && totalElements >= 0 ? totalElements : null;
  const explicitPages = Number.isSafeInteger(totalPages) && totalPages >= 0 ? totalPages : null;
  const pages = explicitPages != null
    ? explicitPages
    : (responseEvents(data).length < pageSize ? 1 : null);
  return {
    totalElements: elements,
    totalPages: pages,
    hasPaginationMetadata: elements != null || explicitPages != null,
  };
}

function addRows(target, rows, identity) {
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = identity(row);
    if (key && !target.has(key)) target.set(key, row);
  }
}

function nextWindowDays(current, preferred, pageCount) {
  if (pageCount <= 1 && current < preferred) return Math.min(preferred, current * 2);
  return current;
}

// Ticketmaster will not return offsets at or beyond 1,000. This collector
// avoids retrying the same first 1,000 events forever by walking a market in
// small UTC date windows. A dense window is halved until it is pageable. If a
// single day still exceeds the provider ceiling, that day is explicitly
// recorded as a coverage gap and the cursor moves on so later dates can still
// enter the catalogue.
//
// `complete` intentionally remains false. A successful slice is not proof that
// Ticketmaster's entire global scope was observed, so it must never authorize
// the existing source-wide stale reconciliation. Consumers may use
// `requestComplete`, `cycleComplete`, and `coverageComplete` for scoped health.
export async function collectTicketmasterPartitionedMarket({
  state,
  now = Date.now(),
  horizonDays = TICKETMASTER_MARKET_HORIZON_DAYS,
  defaultWindowDays = TICKETMASTER_MARKET_WINDOW_DAYS,
  maxRequests = TICKETMASTER_MARKET_REQUEST_BUDGET,
  pageSize = TICKETMASTER_MARKET_PAGE_SIZE,
  requestDelayMs = TICKETMASTER_MARKET_REQUEST_DELAY_MS,
  buildUrl,
  fetchJson,
  rowsFromResponse,
  wait = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
  rowIdentity = (row) => row?.provider_event_id || row?.id,
} = {}) {
  if (typeof buildUrl !== "function" || typeof fetchJson !== "function" || typeof rowsFromResponse !== "function") {
    throw new TypeError("buildUrl, fetchJson, and rowsFromResponse are required");
  }
  const budget = boundedInteger(maxRequests, TICKETMASTER_MARKET_REQUEST_BUDGET, { min: 1, max: 25 });
  const size = boundedInteger(pageSize, TICKETMASTER_MARKET_PAGE_SIZE, { min: 1, max: 200 });
  const delay = boundedInteger(requestDelayMs, TICKETMASTER_MARKET_REQUEST_DELAY_MS, { min: 500, max: 5000 });
  const preferredWindow = boundedInteger(defaultWindowDays, TICKETMASTER_MARKET_WINDOW_DAYS, { min: 1, max: 31 });
  const timestamp = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  let progress = normalizeTicketmasterMarketCoverageState(state, {
    now: timestamp,
    horizonDays,
    defaultWindowDays: preferredWindow,
  });
  const rowsById = new Map();
  const coveredWindows = [];
  let requestsUsed = 0;
  let requestComplete = true;
  let cycleComplete = false;
  let coverageComplete = false;
  let blockedAtOneDay = false;
  let paginationUnproven = false;
  let failure = null;

  const requestPage = async (window, page) => {
    if (requestsUsed >= budget) return null;
    if (requestsUsed > 0) await wait(delay);
    const url = buildUrl({
      startDateTime: window.startDateTime,
      endDateTime: window.endDateTime,
      startEndDateTime: [window.startDateTime, window.endDateTime],
      page,
      size,
    });
    requestsUsed += 1;
    const data = await fetchJson(url);
    addRows(rowsById, rowsFromResponse(data), rowIdentity);
    return data;
  };

  while (requestsUsed < budget) {
    let window = ticketmasterMarketCoverageWindow(progress, {
      now: timestamp,
      horizonDays,
      defaultWindowDays: preferredWindow,
    });
    let first;
    try {
      first = await requestPage(window, 0);
    } catch (error) {
      requestComplete = false;
      failure = error;
      break;
    }
    if (!first) break;
    const totals = responseTotals(first, size);
    const tooDense = (totals.totalElements != null && totals.totalElements > 1000)
      || (totals.totalPages != null && totals.totalPages > TICKETMASTER_MARKET_MAX_PAGES);

    if (tooDense && window.spanDays > 1) {
      progress = {
        ...progress,
        windowDays: Math.max(1, Math.floor(window.spanDays / 2)),
      };
      continue;
    }

    const pagesToFetch = Math.min(
      TICKETMASTER_MARKET_MAX_PAGES,
      totals.totalPages == null ? TICKETMASTER_MARKET_MAX_PAGES : Math.max(1, totals.totalPages),
    );
    let windowFinished = true;
    let paginationProvenComplete = tooDense
      || totals.hasPaginationMetadata
      || responseEvents(first).length < size;
    for (let page = 1; page < pagesToFetch; page += 1) {
      if (requestsUsed >= budget) {
        windowFinished = false;
        break;
      }
      let data;
      try {
        data = await requestPage(window, page);
      } catch (error) {
        requestComplete = false;
        failure = error;
        windowFinished = false;
        break;
      }
      const pageTotals = responseTotals(data, size);
      if (pageTotals.hasPaginationMetadata) paginationProvenComplete = true;
      if (pageTotals.hasPaginationMetadata
          && pageTotals.totalPages != null
          && page + 1 >= pageTotals.totalPages) break;
      if (!pageTotals.hasPaginationMetadata && responseEvents(data).length < size) {
        paginationProvenComplete = true;
        break;
      }
    }
    if (windowFinished && !paginationProvenComplete) {
      // Five full pages without provider totals cannot prove that page five was
      // the end. Keep the cursor on this window instead of silently skipping a
      // sixth page beyond Ticketmaster's deep-page boundary.
      windowFinished = false;
      paginationUnproven = true;
    }
    if (!windowFinished || !requestComplete) break;

    if (tooDense) {
      blockedAtOneDay = true;
      const gap = {
        startDate: window.startDate,
        throughDate: window.throughDate,
        reason: "provider-deep-page-limit",
        observedTotal: totals.totalElements,
      };
      progress = {
        ...progress,
        gaps: [
          ...progress.gaps.filter((entry) => (
            entry.startDate !== gap.startDate || entry.throughDate !== gap.throughDate
          )),
          gap,
        ].slice(-366),
      };
    } else {
      progress = {
        ...progress,
        gaps: progress.gaps.filter((gap) => (
          gap.throughDate < window.startDate || gap.startDate > window.throughDate
        )),
      };
      coveredWindows.push({
        startDate: window.startDate,
        throughDate: window.throughDate,
        totalElements: totals.totalElements,
      });
    }

    const nextCursor = shiftDate(window.throughDate, 1);
    if (nextCursor > window.horizonThrough) {
      cycleComplete = true;
      coverageComplete = progress.gaps.length === 0;
      progress = {
        ...progress,
        cursorDate: window.today,
        windowDays: preferredWindow,
        cycleStartedDate: window.today,
        lastCycleCompletedAt: timestamp,
        lastCompleteThrough: coverageComplete ? window.horizonThrough : progress.lastCompleteThrough,
        gaps: progress.gaps,
      };
      break;
    }
    progress = {
      ...progress,
      cursorDate: nextCursor,
      windowDays: nextWindowDays(window.spanDays, preferredWindow, pagesToFetch),
    };
  }

  const currentWindow = ticketmasterMarketCoverageWindow(progress, {
    now: timestamp,
    horizonDays,
    defaultWindowDays: preferredWindow,
  });
  return {
    rows: [...rowsById.values()],
    complete: false,
    requestComplete,
    cycleComplete,
    coverageComplete,
    blockedAtOneDay,
    paginationUnproven,
    budgetExhausted: requestsUsed >= budget && !cycleComplete,
    requestsUsed,
    coveredWindows,
    coveredThrough: coveredWindows.at(-1)?.throughDate || null,
    horizonThrough: currentWindow.horizonThrough,
    nextState: progress,
    error: failure,
  };
}
