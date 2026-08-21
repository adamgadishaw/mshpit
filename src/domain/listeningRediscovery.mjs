export const FRIEND_LISTENING_FRESH_MS = 60 * 60 * 1000;
export const FRIEND_LISTENING_STALE_MS = 7 * 24 * 60 * 60 * 1000;
export const REDISCOVER_MIN_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const text = (value) => typeof value === "string" ? value.trim() : "";
const trackIdentity = (track) => `${text(track?.artist).toLocaleLowerCase()}|${text(track?.title).toLocaleLowerCase()}`;

function timestamp(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function ageParts(ageMs) {
  const minutes = Math.floor(ageMs / 60000);
  if (minutes < 1) return { amount: 0, unit: "just now" };
  if (minutes < 60) return { amount: minutes, unit: minutes === 1 ? "minute" : "minutes" };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { amount: hours, unit: hours === 1 ? "hour" : "hours" };
  const days = Math.floor(hours / 24);
  return { amount: days, unit: days === 1 ? "day" : "days" };
}

function ageCopy(ageMs, prefix) {
  const part = ageParts(ageMs);
  return part.unit === "just now" ? `${prefix} just now` : `${prefix} ${part.amount} ${part.unit} ago`;
}

export function friendListeningRecency(value, { now = Date.now(), freshMs = FRIEND_LISTENING_FRESH_MS, staleMs = FRIEND_LISTENING_STALE_MS } = {}) {
  const at = timestamp(value);
  const current = timestamp(now);
  if (at == null || current == null || at > current + 5 * 60 * 1000) return null;
  const ageMs = Math.max(0, current - at);
  if (ageMs > staleMs) return null;
  const fresh = ageMs <= freshMs;
  return {
    at,
    ageMs,
    state: fresh ? "fresh" : "last-played",
    label: ageCopy(ageMs, fresh ? "Played" : "Last played"),
  };
}

export function presentFriendsListening(rows, { now = Date.now(), limit = 20 } = {}) {
  const maximum = Math.max(0, Math.min(30, Math.trunc(Number(limit) || 0)));
  const visible = [];
  const seen = new Set();
  for (const entry of Array.isArray(rows) ? rows : []) {
    const userId = text(entry?.user?.id);
    const title = text(entry?.track?.title);
    const recency = friendListeningRecency(entry?.track?.at, { now });
    if (!userId || !title || !recency || seen.has(userId)) continue;
    seen.add(userId);
    visible.push({ ...entry, recency });
  }
  return visible.sort((left, right) => right.recency.at - left.recency.at).slice(0, maximum);
}

export function selectRediscoverTracks(history, { now = Date.now(), minimumAgeMs = REDISCOVER_MIN_AGE_MS, limit = 8 } = {}) {
  const current = timestamp(now);
  const maximum = Math.max(0, Math.min(12, Math.trunc(Number(limit) || 0)));
  if (current == null || !maximum) return [];
  const tracks = new Map();
  for (const candidate of Array.isArray(history) ? history : []) {
    const title = text(candidate?.title);
    const artist = text(candidate?.artist);
    const at = timestamp(candidate?.at);
    const identity = trackIdentity(candidate);
    if (!title || !artist || !identity || at == null || at > current + 5 * 60 * 1000) continue;
    const existing = tracks.get(identity);
    if (!existing || at > existing.lastPlayedAt) tracks.set(identity, { ...candidate, kind: "track", title, artist, lastPlayedAt: at });
  }
  return [...tracks.values()]
    .filter((track) => current - track.lastPlayedAt >= Math.max(24 * 60 * 60 * 1000, Number(minimumAgeMs) || REDISCOVER_MIN_AGE_MS))
    .sort((left, right) => left.lastPlayedAt - right.lastPlayedAt || trackIdentity(left).localeCompare(trackIdentity(right)))
    .slice(0, maximum)
    .map((track) => ({ ...track, ageLabel: ageCopy(current - track.lastPlayedAt, "Last played"), historyScope: "available" }));
}
