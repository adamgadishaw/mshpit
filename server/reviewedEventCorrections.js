import { reviewedFestivalEventRow } from "./reviewedFestivalEventCorrections.js";

// Official corrections take precedence over provider snapshots until reviewed
// again. Never infer a replacement date from an unchanged sales listing.
const PLACEBO_PRAGUE = Object.freeze({
  id: "tm_Z698xZu0Z16vCdfAue",
  source: "ticketmaster",
  providerEventId: "Z698xZu0Z16vCdfAue",
  originalDate: "2026-11-15",
  status: "postponed",
  notice: "New date to be announced. Existing tickets remain valid.",
  sourceUrl: "https://www.ticketportal.cz/Article/11104",
});

// Notice only: keep the original event ID and leave catalog and attendance
// lifecycle rules untouched. The new date already has its own event entry.
const DAX_OLD_TORONTO_ID = "177Zv0G61YPAJyV";
const DAX_TORONTO_NOTICE = Object.freeze({
  eventNotice: "Dax is not playing HISTORY on Nov. 25. The show moved to The Concert Hall (888 Yonge Street) on Dec. 1. Doors at 7 p.m.; show at 8 p.m. Original concert tickets are valid.",
  eventNoticeSource: "https://www.ticketmaster.ca/event/100064AC25166E74",
});

export function reviewedEventNoticeFields(row) {
  if (row?.owner_id != null || row?.ownerId != null) return {};
  const source = String(row?.source || "").trim().toLowerCase();
  const providerId = row?.provider_event_id ?? row?.providerEventId;
  return row?.id === `tm_${DAX_OLD_TORONTO_ID}` && source === "ticketmaster"
    && (providerId == null || providerId === DAX_OLD_TORONTO_ID)
    ? DAX_TORONTO_NOTICE : {};
}

export function reviewedShowNoticeFields(show) {
  const providerEventId = show?.provider_event_id ?? show?.providerEventId;
  return reviewedEventNoticeFields({
    id: show?.tour_date_id || show?.tourDateId || (show?.provider === "ticketmaster" ? `tm_${providerEventId}` : null),
    source: show?.provider,
    provider_event_id: providerEventId,
    owner_id: show?.owner_id ?? show?.ownerId,
  });
}

export function reviewedEventCorrection(row) {
  if (row?.owner_id != null || row?.ownerId != null) return null;
  const source = String(row?.source || "").trim().toLowerCase();
  const providerId = row?.provider_event_id ?? row?.providerEventId;
  return row?.id === PLACEBO_PRAGUE.id && source === PLACEBO_PRAGUE.source
    && (providerId == null || providerId === PLACEBO_PRAGUE.providerEventId)
    ? PLACEBO_PRAGUE : null;
}

// Canonical shows can predate the tour_date_id link. Their verified provider
// tuple still identifies the same correction without a database mutation.
export function reviewedShowCorrection(show) {
  const provider = show?.provider;
  const providerEventId = show?.provider_event_id ?? show?.providerEventId;
  return reviewedEventCorrection({
    id: show?.tour_date_id || show?.tourDateId || (provider === "ticketmaster" ? `tm_${providerEventId}` : null),
    source: provider,
    provider_event_id: providerEventId,
    owner_id: show?.owner_id ?? show?.ownerId,
  });
}

export function reviewedEventRow(row) {
  const correction = reviewedEventCorrection(row);
  if (!correction) return reviewedFestivalEventRow(row);
  return reviewedEventWriteRow(row);
}

// Status reconciliation is independent of read-only festival geography.
export function reviewedEventWriteRow(row) {
  const correction = reviewedEventCorrection(row);
  if (!correction) return row;
  return {
    ...row,
    date: correction.originalDate,
    event_status: correction.status,
    event_end_date: null,
    ...(row.date !== correction.originalDate ? {
      start_date_time: null, start_local_time: null, access_start_date_time: null,
    } : {}),
  };
}

// ID-based exclusion keeps the correction effective even before a stale row is
// rewritten. Direct event reads deliberately do not use this upcoming-only gate.
export function reviewedEventUpcomingSql(alias = "td") {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new TypeError("Invalid tour-date SQL alias");
  // The canonical tm_ event ID already contains the provider namespace. Some
  // lifecycle callers intentionally select no optional provider metadata.
  return `(${alias}.owner_id IS NOT NULL OR ${alias}.id<>'${PLACEBO_PRAGUE.id}')`;
}
