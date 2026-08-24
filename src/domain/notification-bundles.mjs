export const NOTIFICATION_BUNDLE_WINDOW_MS = 24 * 60 * 60 * 1_000;

const text = (value) => typeof value === "string" ? value.trim() : "";
const timestamp = (value) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;

function notificationId(notification) {
  const id = text(notification?.id);
  if (id) return id;
  return JSON.stringify([
    text(notification?.type),
    timestamp(notification?.ts),
    text(notification?.actorId),
    text(notification?.postId),
    text(notification?.artist),
    text(notification?.text),
  ]);
}

function compareNotifications(left, right) {
  const byTime = timestamp(right?.ts) - timestamp(left?.ts);
  if (byTime) return byTime;
  const leftId = notificationId(left);
  const rightId = notificationId(right);
  if (leftId === rightId) return 0;
  return leftId < rightId ? 1 : -1;
}

export function notificationBundleTarget(notification) {
  const type = text(notification?.type).toLowerCase() || "activity";
  if (type === "follow") return "account";
  if (type === "dm") return text(notification?.actorId)
    ? `thread:${text(notification.actorId)}`
    : `notification:${notificationId(notification)}`;
  if (type === "like" || type === "comment" || type === "post_tag") return text(notification?.postId)
    ? `post:${text(notification.postId)}`
    : `notification:${notificationId(notification)}`;
  if (type === "welcome") return `notification:${notificationId(notification)}`;
  if (text(notification?.postId)) return `post:${text(notification.postId)}`;
  if (text(notification?.artist)) return `artist:${text(notification.artist).toLowerCase()}`;
  if (text(notification?.actorId)) return `actor:${text(notification.actorId)}`;
  return `notification:${notificationId(notification)}`;
}

export function notificationBundleKey(notification) {
  const type = text(notification?.type).toLowerCase() || "activity";
  return `${type}|${notificationBundleTarget(notification)}`;
}

function notificationActors(items) {
  const seen = new Set();
  const actors = [];
  for (const notification of items) {
    const actorId = text(notification?.actorId);
    const actorName = text(notification?.actorName) || "Someone";
    const key = actorId
      ? `id:${actorId}`
      : actorName !== "Someone"
        ? `name:${actorName.toLocaleLowerCase()}`
        : `notification:${notificationId(notification)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    actors.push({ id: actorId || null, name: actorName });
  }
  return actors;
}

export function notificationActorSummary(value) {
  const items = Array.isArray(value?.items) ? value.items : (Array.isArray(value) ? value : []);
  const actors = notificationActors(items);
  if (!actors.length) return "Someone";
  if (actors.length === 1) return actors[0].name;
  if (actors.length === 2) return `${actors[0].name} and ${actors[1].name}`;
  return `${actors[0].name} and ${actors.length - 1} others`;
}

export function bundleNotifications(notifications, { windowMs = NOTIFICATION_BUNDLE_WINDOW_MS } = {}) {
  const duration = Number.isFinite(Number(windowMs)) ? Math.max(0, Number(windowMs)) : NOTIFICATION_BUNDLE_WINDOW_MS;
  const ordered = (Array.isArray(notifications) ? notifications : [])
    .filter((notification) => notification && typeof notification === "object")
    .slice()
    .sort(compareNotifications);
  const latestByKey = new Map();
  const groups = [];

  for (const notification of ordered) {
    const key = notificationBundleKey(notification);
    const at = timestamp(notification.ts);
    let group = latestByKey.get(key);
    if (!group || group.newestTs - at > duration) {
      group = {
        key,
        newestTs: at,
        oldestTs: at,
        items: [],
      };
      latestByKey.set(key, group);
      groups.push(group);
    }
    group.items.push(notification);
    group.oldestTs = Math.min(group.oldestTs, at);
  }

  return groups.map((group) => {
    const primary = group.items[0];
    const actors = notificationActors(group.items);
    return {
      id: `bundle:${group.key}:${notificationId(primary)}`,
      key: group.key,
      type: text(primary?.type).toLowerCase() || "activity",
      target: notificationBundleTarget(primary),
      primary,
      items: group.items,
      count: group.items.length,
      actors,
      actorCount: actors.length,
      actorSummary: notificationActorSummary(group.items),
      ts: group.newestTs,
      oldestTs: group.oldestTs,
      read: group.items.every((item) => !!item.read),
    };
  });
}
