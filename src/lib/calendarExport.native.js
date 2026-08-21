import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { buildCalendarDocument, calendarExportFileName } from "../domain/calendarExport.mjs";

export async function exportCalendarEvents(events) {
  if (!(await Sharing.isAvailableAsync())) throw new Error("Calendar sharing is unavailable on this device.");
  const fileName = calendarExportFileName(events);
  const file = new File(Paths.cache, fileName);
  file.create({ overwrite: true, intermediates: true });
  file.write(buildCalendarDocument(events));
  await Sharing.shareAsync(file.uri, {
    mimeType: "text/calendar",
    UTI: "public.calendar-event",
    dialogTitle: "Save concert to calendar",
  });
  return { fileName };
}
