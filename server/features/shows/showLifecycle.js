import { liveEventQueryFloorDate } from "../../../src/domain/eventLifecycle.mjs";

// Both public Show reads and authoritative attendance resolution use the same
// clock/status policy. Persisted Show lifecycle is only a historical projection.
export function tourDateShowLifecycle(row, at) {
  const status = String(row?.event_status || "").trim().toLowerCase();
  if (status === "cancelled" || status === "canceled") return "cancelled";
  if (status === "postponed") return "postponed";
  const startAt = Date.parse(row?.start_date_time || "");
  if (Number.isFinite(startAt)) {
    if (at < startAt) return "upcoming";
    return at <= startAt + 12 * 60 * 60 * 1000 ? "happening" : "completed";
  }
  const today = liveEventQueryFloorDate(at);
  if (row?.date && row.date < today) return "completed";
  if (row?.date > today) return "upcoming";
  return "unknown";
}
