import { calendarDateKey } from "../src/domain/dataPolicy.mjs";

const sqlAlias = (value) => {
  const alias = String(value || "");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new TypeError("Invalid tour-date SQL alias");
  return alias;
};

// Treat only a strict, later ISO end date as a range. Bad legacy metadata falls
// back to the start date rather than keeping an event current indefinitely.
export function effectiveTourDateEndSql(alias = "td") {
  const table = sqlAlias(alias);
  return "COALESCE(CASE WHEN date(" + table + ".event_end_date)=" + table + ".event_end_date AND "
    + table + ".event_end_date>" + table + ".date THEN " + table + ".event_end_date END," + table + ".date)";
}

export function currentOrUpcomingTourDateSql(alias = "td", placeholder = "?") {
  return effectiveTourDateEndSql(alias) + ">=" + placeholder;
}

export function currentOrUpcomingTourDateRow(row, today) {
  const start = calendarDateKey(row?.date);
  const current = calendarDateKey(today);
  if (start == null || current == null) return false;
  const end = calendarDateKey(row?.event_end_date ?? row?.eventEndDate);
  return (end != null && end > start ? end : start) >= current;
}
