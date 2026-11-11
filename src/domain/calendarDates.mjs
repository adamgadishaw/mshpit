// Calendar browsing reads archival and announced dates over its explicit UI
// range. Composer writes retain the narrower validation in dates.mjs.
export function calendarReadDate(value) {
  const match = /^(\d{4})\D{1,3}(\d{1,2})\D{1,3}(\d{1,2})$/.exec(String(value ?? "").trim());
  if (!match) return "";
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return "";
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
