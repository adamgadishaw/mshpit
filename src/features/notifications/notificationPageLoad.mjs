const READ_CONTRACT = "notification-ids-v1";
const MAX_NOTIFICATION_ROWS = 1000;
const unreadRows = rows => rows.filter(row => !row.read).length;
const welcomeUnread = rows => unreadRows(rows.filter(row => row.type === "welcome"));
const uniqueRows = rows => [...new Map(rows.map(row => [String(row.id), row])).values()]
  .sort((a, b) => b.ts - a.ts || String(b.id).localeCompare(String(a.id)));

function project(payload, previous, more, { accountId, getHiddenActorIds, makeError }) {
    if (!Array.isArray(payload?.notifications) || !Number.isSafeInteger(payload?.unread) || payload.unread < 0
      || (payload.nextCursor != null && typeof payload.nextCursor !== "string")) throw makeError("Activity returned an invalid response. Try again.");
    const hiddenActors = new Set(getHiddenActorIds());
    const rows = payload.notifications.map(row => {
      if (!row || typeof row.id !== "string" || !row.id || !Number.isFinite(row.ts)) throw makeError("Activity returned an invalid response. Try again.");
      return { ...row, userId: accountId, read: !!row.read };
    }).filter(row => !row.actorId || !hiddenActors.has(row.actorId));
    const retained = more ? previous.rows : previous.rows.filter(row => row.type === "welcome");
    const combined = uniqueRows([...retained, ...rows]);
    const historyLimited = combined.length > MAX_NOTIFICATION_ROWS || (combined.length === MAX_NOTIFICATION_ROWS && !!payload.nextCursor);
    return {
      rows: combined.slice(0, MAX_NOTIFICATION_ROWS),
      unread: payload.unread + welcomeUnread(combined),
      nextCursor: historyLimited ? null : payload.nextCursor || null,
      readContract: payload.readContract === READ_CONTRACT ? READ_CONTRACT : null,
      historyLimited,
    };
  }

// This account-only implementation is downloaded on first use, not during the
// public app startup. Queue order and the visible loading state are reserved by
// the controller first. The current scope is rechecked before every transport.
export async function loadNotificationPage({ cursor, summary, more, demo, seed, fetchPage, makeError, getHiddenActorIds, signal, assertCurrent, getCurrent, adopt }) {
  let payload;
  for (let attempt = 0; attempt < 3; attempt++) {
    assertCurrent();
    const before = getCurrent();
    const demoRows = before.updatedAt == null ? seed.filter(row => row.userId === before.accountId) : before.data.rows;
    payload = demo ? { notifications: demoRows, unread: unreadRows(demoRows), nextCursor: null, readContract: READ_CONTRACT }
      : await fetchPage({ accountId: before.accountId, cursor, signal, limit: summary ? 1 : 100 });
    assertCurrent();
    if (before.revision === getCurrent().revision) break;
    // Confirmed DM reads/privacy scrubs bypass this queue. Refetch rather than
    // resurrecting a snapshot captured before that mutation.
    if (attempt === 2) throw makeError("Activity changed while refreshing. Try again.");
  }
  assertCurrent();
  const current = getCurrent();
  const data = project(payload, current.data, more, { accountId: current.accountId, getHiddenActorIds, makeError });
  adopt(data, payload.unread);
  return data.rows;
}
