// Use one explicit timezone in screenshots and email so occurrence times can
// be compared with server logs without relying on the reader's device locale.
export function formatErrorOccurrenceTime(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toISOString().replace("T", " ").replace("Z", " UTC");
}

// An hourly aggregate identifies a bucket, not a precise occurrence timestamp.
export function formatErrorObservedHour(value) {
  const formatted = formatErrorOccurrenceTime(value);
  return formatted ? `${formatted.slice(0, 13)}:00 UTC (hour bucket)` : "";
}
