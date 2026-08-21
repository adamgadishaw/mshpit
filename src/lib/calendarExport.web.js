import { buildCalendarDocument, calendarExportFileName } from "../domain/calendarExport.mjs";

export async function exportCalendarEvents(events) {
  if (typeof document === "undefined" || typeof URL === "undefined") throw new Error("Calendar downloads are unavailable here.");
  const contents = buildCalendarDocument(events);
  const fileName = calendarExportFileName(events);
  const url = URL.createObjectURL(new Blob([contents], { type: "text/calendar;charset=utf-8" }));
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  return { fileName };
}
