import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import useIOSDetailPresentation from "../../hooks/useIOSDetailPresentation";
import { calendarShowsQuery } from "./calendarShowsRequest.mjs";
import { createCalendarShowsController } from "./calendarShowsController.mjs";
import { calendarShowsError, readCalendarShows } from "./calendarShowsApi";

const alwaysCurrent = () => true;

export default function useCalendarShows({ cursor, selected, presentation = "month", scope = "all", homeCity, homeCountry,
  accountId = null, authEpoch = null, enabled = true, isCurrent = alwaysCurrent, capture } = {}) {
  const detail = useIOSDetailPresentation();
  const query = useMemo(() => calendarShowsQuery({ cursor, selected, presentation, scope, homeCity, homeCountry,
    accountId, authEpoch, enabled }), [cursor.y, cursor.m, selected, presentation, scope, homeCity, homeCountry, accountId, authEpoch, enabled]);
  const summary = useRef(null);
  // The selected-day rows never cross a query boundary. Only a same-owner,
  // same-month presence summary can remain visible while a different day loads.
  const controller = useMemo(() => createCalendarShowsController({ query, read: readCalendarShows, asError: calendarShowsError,
    initialSummary: summary.current?.monthKey === query.monthKey ? summary.current.value : null,
  }), [query.key, query.enabled]);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const admitted = capture ? capture() : isCurrent;
  const allows = () => admitted() && detail.current();
  useEffect(() => {
    if (!detail.active || !allows()) { controller.pause(); return undefined; }
    controller.resume();
    if (!controller.getSnapshot().updatedAt && query.enabled) void controller.refresh({ current: allows });
    return controller.pause;
  }, [controller, detail.active, detail.token, admitted]);
  useEffect(() => () => controller.dispose(), [controller]);
  useEffect(() => {
    if (snapshot.status === "ready") summary.current = { monthKey: query.monthKey,
      value: { dayPresence: snapshot.dayPresence, complete: snapshot.summaryComplete } };
    else if (summary.current?.monthKey !== query.monthKey) summary.current = null;
  }, [snapshot, query.monthKey]);
  return { ...snapshot,
    refresh: (options) => controller.refresh({ ...options, current: allows }),
    loadMore: () => controller.loadMore({ current: allows }),
  };
}
