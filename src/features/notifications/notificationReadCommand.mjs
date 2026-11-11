import { commandFailure, commandSuccess } from "../../domain/commandResult.mjs";
import { reconcileConfirmedNotificationReads } from "../../domain/notificationReadMutation.mjs";

const READ_CONTRACT = "notification-ids-v1";
const unreadRows = rows => rows.filter(row => !row.read).length;
const welcomeUnread = rows => unreadRows(rows.filter(row => row.type === "welcome"));
const aborted = () => Object.assign(new Error("Activity request is no longer current."), { name: "AbortError" });

// Loaded only for an explicit acknowledgement. The controller captures the IDs
// and reserves queue order before importing this module. It owns scope fences
// and publication; this command never stores private data beyond the operation.
export async function acknowledgeNotificationRows({ ids, signal, transportSignal, demo, writeReads, makeError, assertCurrent, getCurrent, adopt }) {
  const confirmed = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    assertCurrent();
    if (signal?.aborted || transportSignal.aborted) throw aborted();
    const before = getCurrent();
    const chunk = ids.slice(offset, offset + 100);
    const localIds = before.data.rows.filter(row => row.type === "welcome" && chunk.includes(row.id)).map(row => row.id);
    const remoteIds = chunk.filter(id => !localIds.includes(id));
    const response = demo || !remoteIds.length ? { readContract: READ_CONTRACT, notificationIds: remoteIds }
      : await writeReads({ accountId: before.accountId, notificationIds: remoteIds, signal: transportSignal });
    assertCurrent();
    if (signal?.aborted || transportSignal.aborted) throw aborted();
    if (response?.readContract !== READ_CONTRACT || !Array.isArray(response.notificationIds)
      || response.notificationIds.some(id => !remoteIds.includes(id)) || (remoteIds.length && !demo && (!Number.isSafeInteger(response.unread) || response.unread < 0))) {
      throw makeError("Activity read status could not be confirmed. Refresh and try again.");
    }
    const current = getCurrent();
    const acknowledged = [...new Set([...localIds, ...response.notificationIds])];
    const previous = current.data.rows;
    const rows = reconcileConfirmedNotificationReads(previous, { accountId: current.accountId, notificationIds: acknowledged });
    const unread = before.revision === current.revision && Number.isSafeInteger(response.unread) ? response.unread + welcomeUnread(rows)
      : current.data.unread == null ? null : Math.max(0, current.data.unread + unreadRows(rows) - unreadRows(previous));
    adopt({ ...current.data, rows, unread });
    confirmed.push(...acknowledged);
  }
  return { notificationIds: confirmed, unread: getCurrent().data.unread };
}

export async function markNotificationRows(options) {
  const { snapshot, notificationIds, signal, transportSignal, makeError, assertCurrent } = options;
  assertCurrent();
  if (signal?.aborted || transportSignal.aborted) throw aborted();
  if (snapshot.readContract !== READ_CONTRACT) return commandFailure(makeError("Marking activity read is not available on this server yet. Your unread activity is unchanged."));
  if (!Array.isArray(notificationIds) || notificationIds.some(id => typeof id !== "string" || !id)) {
    return commandFailure(makeError("Choose the loaded activity to mark read."));
  }
  const loaded = new Set(snapshot.rows.filter(row => !row.read).map(row => row.id));
  const ids = [...new Set(notificationIds)].filter(id => loaded.has(id));
  if (!ids.length) return commandSuccess({ notificationIds: [], unread: snapshot.unread });
  return commandSuccess(await acknowledgeNotificationRows({ ...options, ids }));
}
