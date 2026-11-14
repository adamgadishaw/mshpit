import { defaultDiscoverAreaChoice, resolveDiscoverAreaChoice } from "./discoverArea.mjs";
import { DISCOVER_RANGE_DAYS } from "./discoverEventRange.mjs";

// Keep choices, never API results, in the owning App while a detail is open.
// Account changes discard the previous person's location and filters.
export function restoreDiscoverViewState(saved, context = {}) {
  const current = saved?.accountId === (context.accountId || null) ? saved : null;
  return {
    accountId: context.accountId || null,
    areaChoice: current?.areaChoice
      ? resolveDiscoverAreaChoice(current.areaChoice, context)
      : defaultDiscoverAreaChoice(context),
    days: DISCOVER_RANGE_DAYS.includes(current?.days) ? current.days : DISCOVER_RANGE_DAYS[0],
    query: typeof current?.query === "string" ? current.query : "",
    genre: typeof current?.genre === "string" ? current.genre : null,
    week: typeof current?.week === "string" ? current.week : null,
  };
}
