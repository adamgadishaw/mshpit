import { toIsoDate } from "./dates.mjs";

const PLAN_STATES = new Set(["interested", "going"]);
const text = (value) => String(value || "").trim();
const normalized = (value) => text(value).toLocaleLowerCase();

function identityAliases(show) {
  const aliases = [];
  const add = (prefix, value) => {
    const cleaned = text(value);
    if (cleaned) aliases.push(`${prefix}:${cleaned}`);
  };
  add("show", show?.showId);
  add("show", show?.id && String(show.id).startsWith("show_") ? show.id : null);
  add("tour-date", show?.tourDateId);
  add("key", show?.canonicalKey);
  add("key", show?.key);
  const day = toIsoDate(show?.localDate || show?.date || show?.startDateTime);
  if (normalized(show?.artist) && normalized(show?.venue) && day) {
    aliases.push(`night:${normalized(show.artist)}|${normalized(show.venue)}|${day}`);
  }
  return [...new Set(aliases)];
}

function targetFor(show) {
  const exact = Number(show?.startsAt);
  if (Number.isFinite(exact) && exact > 0) return exact;
  const raw = show?.startDateTime || show?.startDate || show?.localDate || show?.date;
  if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}T/u.test(raw)) {
    const timestamp = Date.parse(raw);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  const day = toIsoDate(raw);
  if (!day) return null;
  const [year, month, date] = day.split("-").map(Number);
  const fallback = new Date(year, month - 1, date, 20, 0, 0).getTime();
  return Number.isFinite(fallback) ? fallback : null;
}

function matchingCatalogueRow(show, catalogue, catalogueByAlias) {
  for (const alias of identityAliases(show)) {
    const row = catalogueByAlias.get(alias);
    if (row) return row;
  }
  const day = toIsoDate(show?.localDate || show?.date);
  if (!day) return null;
  return catalogue.find((row) => toIsoDate(row?.localDate || row?.date) === day
    && normalized(row?.artist) === normalized(show?.artist)
    && normalized(row?.venue) === normalized(show?.venue)) || null;
}

export function homeShowCountdownPlan({ attendance = [], going = [], upcoming = [], now = Date.now() } = {}) {
  const catalogue = Array.isArray(upcoming) ? upcoming.filter(Boolean) : [];
  const catalogueByAlias = new Map();
  for (const row of catalogue) {
    for (const alias of identityAliases(row)) if (!catalogueByAlias.has(alias)) catalogueByAlias.set(alias, row);
  }

  const candidates = [];
  const claimedAliases = new Set();
  const add = (source, fallbackState = null) => {
    if (!source || typeof source !== "object") return;
    const state = normalized(source.state) || fallbackState;
    if (!PLAN_STATES.has(state)) return;
    const catalogueRow = matchingCatalogueRow(source, catalogue, catalogueByAlias);
    const event = { ...(catalogueRow || {}), ...source, state };
    const aliases = identityAliases(event);
    if (aliases.some((alias) => claimedAliases.has(alias))) return;
    const targetMs = targetFor(event);
    if (targetMs == null || targetMs <= now) return;
    aliases.forEach((alias) => claimedAliases.add(alias));
    candidates.push({ event, state, targetMs });
  };

  // Canonical attendance owns the current state. Legacy Going rows are only a
  // rolling-deploy fallback and must never override a newer Interested choice.
  for (const row of Array.isArray(attendance) ? attendance : []) add(row);
  for (const row of Array.isArray(going) ? going : []) add(row, "going");

  candidates.sort((left, right) => left.targetMs - right.targetMs
    || normalized(left.event.artist).localeCompare(normalized(right.event.artist)));
  const featured = candidates[0];
  if (!featured) return null;
  const upNext = candidates.slice(1, 3);
  return {
    ...featured,
    upNext,
    totalPlans: candidates.length,
    remainingCount: Math.max(0, candidates.length - 1 - upNext.length),
  };
}

export function humanShowCountdown(targetMs, now = Date.now()) {
  const remaining = Number(targetMs) - Number(now);
  if (!Number.isFinite(remaining)) return "Date to be announced";
  if (remaining <= 0) return "Starting now";
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (remaining >= 36 * hour) return `In ${Math.max(2, Math.round(remaining / day))} days`;
  if (remaining >= 20 * hour) return "Tomorrow";
  if (remaining >= hour) {
    const hours = Math.max(1, Math.round(remaining / hour));
    return `In ${hours} hour${hours === 1 ? "" : "s"}`;
  }
  if (remaining >= minute) {
    const minutes = Math.max(1, Math.round(remaining / minute));
    return `In ${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return "Starting soon";
}

export function homeShowStatusLabel(state) {
  return state === "interested" ? "Interested" : "Going";
}
