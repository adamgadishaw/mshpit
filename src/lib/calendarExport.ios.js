import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { buildCalendarDocument, calendarExportFileName } from "../domain/calendarExport.mjs";

const cacheNamespace = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
let sequence = 0;
let presentation = null;
const cancelled = () => ({ status: "cancelled" });

export async function exportCalendarEvents(events, { isCurrent = () => true, onPresenting = () => {} } = {}) {
  if (!isCurrent()) return cancelled();
  const available = await Sharing.isAvailableAsync();
  if (!isCurrent()) return cancelled();
  if (!available) throw new Error("Calendar sharing is unavailable on this device.");
  // A presented sheet cannot be cancelled by Expo. Keep this gate across route
  // unmounts and account changes until that native promise actually settles.
  if (presentation) throw new Error("Finish or dismiss the open share sheet, then try again.");
  const fileName = calendarExportFileName(events);
  const contents = buildCalendarDocument(events);
  if (!isCurrent()) return cancelled();
  const temporaryName = `${fileName.slice(0, -4)}-${cacheNamespace}-${++sequence}.ics`;
  const file = new File(Paths.cache, temporaryName);
  let ownsFile = false;
  let cleanupFailed = false;
  const claim = {};
  try {
    if (!isCurrent()) return cancelled();
    // Never overwrite or delete a pre-existing file, even on a name collision.
    file.create({ overwrite: false, intermediates: true });
    ownsFile = true;
    if (!isCurrent()) return cancelled();
    file.write(contents);
    if (!isCurrent()) return cancelled();
    if (presentation) throw new Error("Finish or dismiss the open share sheet, then try again.");
    presentation = claim;
    onPresenting();
    await Sharing.shareAsync(file.uri, {
      mimeType: "text/calendar",
      UTI: "public.calendar-event",
      dialogTitle: "Save concert to calendar",
    });
  } finally {
    if (presentation === claim) presentation = null;
    // Do not remove the file while native sharing still needs it. Only this
    // operation's successfully-created file is ours, including partial writes.
    if (ownsFile) {
      try { file.delete(); } catch { cleanupFailed = true; }
    }
  }
  // shareAsync resolves void on dismissal, including cancellation. It is not a
  // receipt for adding an event to Calendar or saving the file in another app.
  return { status: "finished", fileName, cleanupFailed };
}
