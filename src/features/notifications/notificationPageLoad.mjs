import { mergeNotificationHistory } from "../../domain/notificationReadMutation.mjs";
const READ_CONTRACT = "notification-ids-v1";
const MAX_NOTIFICATION_ROWS = 1000;
const unreadRows = rows => rows.filter(row => !row.read).length;
const welcomeUnread = rows => unreadRows(rows.filter(row => row.type === "welcome"));
const uniqueRows = rows => [...new Map(rows.map(row => [String(row.id), row])).values()]
  .sort((a, b) => b.ts - a.ts || String(b.id).localeCompare(String(a.id)));

function project(payload, previous, more, updates, { allHistory, accountId, getHiddenActorIds, makeError }) {
    if (!Array.isArray(payload?.notifications) || !Number.isSafeInteger(payload?.unread) || payload.unread < 0
      || (payload.inboxUnread != null && (!Number.isSafeInteger(payload.inboxUnread) || payload.inboxUnread < 0))
      || (payload.nextCursor != null && typeof payload.nextCursor !== "string")) throw makeError("Activity returned an invalid response. Try again.");
    const hiddenActors = new Set(getHiddenActorIds());
    const rows = payload.notifications.map(row => {
      if (!row || typeof row.id !== "string" || !row.id || !Number.isFinite(row.ts)) throw makeError("Activity returned an invalid response. Try again.");
      return { ...row, userId: accountId, read: !!row.read };
    }).filter(row => !row.actorId || !hiddenActors.has(row.actorId));
    // An automatic head update keeps older pages only when the new head joins
    // the loaded history. Otherwise restart at the server cursor, never invent
    // continuity across >100 unseen events. A complete head replaces all rows.
    const oldest = rows.at(-1);
    const overlap = updates && payload.nextCursor && rows.some(row => previous.rows.some(old => old.id === row.id));
    const older = overlap ? previous.rows.filter(row => row.type !== "welcome" && oldest
      && (row.ts < oldest.ts || (row.ts === oldest.ts && String(row.id) < String(oldest.id)))) : [];
    const retained = more || (updates && previous.historyComplete && payload.nextCursor) ? previous.rows : [...previous.rows.filter(row => row.type === "welcome"), ...older];
    const nextCursor = overlap ? previous.nextCursor : payload.nextCursor;
    const combined = uniqueRows([...retained, ...rows].filter(row => !row.actorId || !hiddenActors.has(row.actorId)));
    const rowLimit = allHistory || previous.historyComplete ? Infinity : MAX_NOTIFICATION_ROWS;
    const historyLimited = combined.length > rowLimit || (combined.length === rowLimit && !!nextCursor) || !!(overlap && previous.historyLimited);
    return {
      rows: combined.slice(0, rowLimit),
      unread: payload.unread + welcomeUnread(combined),
      inboxUnread: payload.inboxUnread ?? null,
      nextCursor: historyLimited ? null : nextCursor || null,
      readContract: payload.readContract === READ_CONTRACT ? READ_CONTRACT : null,
      historyLimited,
      historyComplete: allHistory || !!previous.historyComplete,
    };
  }

// This account-only implementation is downloaded on first use, not during the
// public app startup. Queue order and the visible loading state are reserved by
// the controller first. The current scope is rechecked before every transport.
export async function loadNotificationPage({ cursor, summary, more, updates, allHistory, demo, seed, fetchPage, makeError, getHiddenActorIds, signal, assertCurrent, getCurrent, adopt }) {
  let payload;
  const captured = getCurrent();
  for (let attempt = 0; attempt < 3; attempt++) {
    assertCurrent();
    const before = getCurrent();
    const demoRows = before.updatedAt == null ? seed.filter(row => row.userId === before.accountId) : before.data.rows;
    payload = demo ? { notifications: demoRows, unread: unreadRows(demoRows), nextCursor: null, readContract: READ_CONTRACT }
      : await fetchPage({ accountId: before.accountId, cursor, signal, limit: summary ? 1 : 100 });
    if (allHistory && !demo) {
      const collected = new Map((payload?.notifications || []).map(row => [row.id, row]));
      const cursors = new Set();
      let nextCursor = payload?.nextCursor;
      while (nextCursor) {
        assertCurrent();
        if (cursors.has(nextCursor)) throw makeError("Activity pagination did not advance. Try again.");
        cursors.add(nextCursor);
        const next = await fetchPage({ accountId: before.accountId, cursor: nextCursor, signal, limit: 100 });
        assertCurrent();
        if (!Array.isArray(next?.notifications)) throw makeError("Activity returned an invalid response. Try again.");
        for (const row of next.notifications) collected.set(row.id, row);
        nextCursor = next.nextCursor;
      }
      payload = { ...payload, notifications: [...collected.values()], nextCursor: null };
    }
    assertCurrent();
    if (allHistory || before.revision === getCurrent().revision) break;
    // Confirmed DM reads/privacy scrubs bypass this queue. Refetch rather than
    // resurrecting a snapshot captured before that mutation.
    if (attempt === 2) throw makeError("Activity changed while refreshing. Try again.");
  }
  assertCurrent();
  const current = getCurrent();
  const data = project(payload, current.data, more, updates, { allHistory, accountId: current.accountId, getHiddenActorIds, makeError });
  if (allHistory) {
    const fetched = data.rows;
    const hiddenActors = new Set(getHiddenActorIds());
    data.rows = uniqueRows(mergeNotificationHistory(current.data.rows, fetched, { accountId: current.accountId, capturedRows: captured.data.rows })
      .filter(row => !row.actorId || !hiddenActors.has(row.actorId)));
    if (current.revision !== captured.revision && current.data.unread != null) {
      data.unread = Math.max(0, current.data.unread + unreadRows(data.rows) - unreadRows(current.data.rows));
    }
    adopt(data, payload.unread);
    // The opening command receives only its captured server history. Arrivals
    // merged into the visible resource while reading remain new.
    return fetched;
  }
  adopt(data, payload.unread);
  return data.rows;
}
