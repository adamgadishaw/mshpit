const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_PARTS = /^(\d{4})\D{1,3}(\d{1,2})\D{1,3}(\d{1,2})$/;

const text = (value) => typeof value === "string" ? value.trim() : "";

function clockMs(value) {
  const parsed = value instanceof Date ? value.getTime() : Number(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function calendarDate(value) {
  const match = DATE_PARTS.exec(String(value ?? "").trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900) return null;
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { year, month, day, timestamp, iso: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` };
}

function visibleOwnConcert(log, ownerId) {
  if (!log || typeof log !== "object" || !text(log.id)) return false;
  if (ownerId != null && String(log.userId || "") !== String(ownerId)) return false;
  if (log.removed || log.deleted || log.hidden || log.visible === false) return false;
  if (["removed", "deleted", "hidden"].includes(text(log.status).toLowerCase())) return false;
  return log.kind !== "status" && !!text(log.artist) && !!text(log.venue);
}

function dayKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function anniversaryFor(date, nowStart, nowYear) {
  const years = nowYear - date.year;
  if (years < 1) return null;
  const timestamp = Date.UTC(nowYear, date.month - 1, date.day);
  const anniversary = new Date(timestamp);
  if (anniversary.getUTCMonth() !== date.month - 1 || anniversary.getUTCDate() !== date.day) return null;
  const offsetDays = Math.round((timestamp - nowStart) / DAY_MS);
  if (Math.abs(offsetDays) > 14) return null;
  const when = offsetDays === 0
    ? `${years} ${years === 1 ? "year" : "years"} ago today`
    : offsetDays > 0
      ? `${years}-year anniversary in ${offsetDays} ${offsetDays === 1 ? "day" : "days"}`
      : `${years}-year anniversary ${Math.abs(offsetDays)} ${Math.abs(offsetDays) === 1 ? "day" : "days"} ago`;
  return { years, offsetDays, when };
}

function memoryFrom(log, date, kind, detail) {
  return {
    id: `${kind}:${log.id}`,
    kind,
    log,
    artist: text(log.artist),
    venue: text(log.venue),
    city: text(log.city) || null,
    date: date.iso,
    rating: Number.isFinite(Number(log.overall)) ? Number(log.overall) : null,
    detail,
  };
}

export function selectConcertMemories(logs, { ownerId = null, now = Date.now(), limit = 2, anniversaryWindowDays = 14, rediscoverAfterDays = 90 } = {}) {
  const maximum = Math.max(0, Math.min(4, Math.trunc(Number(limit) || 0)));
  if (!maximum) return [];
  const currentMs = clockMs(now);
  const current = new Date(currentMs);
  const nowStart = Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate());
  const windowDays = Math.max(0, Math.min(31, Math.trunc(Number(anniversaryWindowDays) || 0)));
  const minimumAgeDays = Math.max(30, Math.trunc(Number(rediscoverAfterDays) || 90));
  const eligible = [];
  const seen = new Set();

  for (const log of Array.isArray(logs) ? logs : []) {
    if (!visibleOwnConcert(log, ownerId) || seen.has(String(log.id))) continue;
    const date = calendarDate(log.date);
    if (!date || date.timestamp >= nowStart) continue;
    seen.add(String(log.id));
    const anniversary = anniversaryFor(date, nowStart, current.getUTCFullYear());
    const ageDays = Math.floor((nowStart - date.timestamp) / DAY_MS);
    eligible.push({ log, date, anniversary: anniversary && Math.abs(anniversary.offsetDays) <= windowDays ? anniversary : null, ageDays });
  }

  const anniversaries = eligible
    .filter((entry) => entry.anniversary)
    .sort((left, right) => Math.abs(left.anniversary.offsetDays) - Math.abs(right.anniversary.offsetDays)
      || right.anniversary.years - left.anniversary.years
      || String(left.log.id).localeCompare(String(right.log.id)));
  const selected = anniversaries.slice(0, maximum).map((entry) => memoryFrom(entry.log, entry.date, "anniversary", entry.anniversary.when));
  const selectedIds = new Set(selected.map((entry) => String(entry.log.id)));

  if (selected.length < maximum) {
    const rotation = dayKey(nowStart);
    const rediscovery = eligible
      .filter((entry) => entry.ageDays >= minimumAgeDays && !selectedIds.has(String(entry.log.id)))
      .sort((left, right) => stableHash(`${rotation}:${left.log.id}`) - stableHash(`${rotation}:${right.log.id}`)
        || String(left.log.id).localeCompare(String(right.log.id)));
    for (const entry of rediscovery) {
      selected.push(memoryFrom(entry.log, entry.date, "rediscovery", `From ${entry.date.year}`));
      if (selected.length >= maximum) break;
    }
  }
  return selected;
}

export function concertMemoryShareText(memory) {
  const artist = text(memory?.artist) || "a live show";
  const venue = text(memory?.venue);
  const date = text(memory?.date);
  return [`Remembering ${artist}${venue ? ` at ${venue}` : ""}${date ? ` on ${date}` : ""}.`, "Part of my live-music history on Mshpit."].join(" ");
}
