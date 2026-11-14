import { calendarEventTiming } from "./calendarEventTiming.mjs";
import { normalizeStableShowId } from "./showAttendance.mjs";

const text = (value) => typeof value === "string" ? value.normalize("NFKC").trim() : "";
const lower = (value) => text(value).toLocaleLowerCase();
const unique = (values) => [...new Set(values.filter(Boolean))].sort();

/** Post IDs and attendance row IDs are provenance, never event identities. */
export function calendarSourceIds(row = {}) {
  const previous = row.calendarSourceIds || {};
  const showIds = unique([...(previous.showIds || []), text(row.showId), normalizeStableShowId(row.id)]);
  const tourDateIds = unique([
    ...(previous.tourDateIds || []), text(row.tourDateId),
    !row.postId && !normalizeStableShowId(row.id) ? text(row.id) : "",
  ]);
  const provider = lower(typeof row.provider === "object" ? row.provider?.name : row.provider || row.source);
  const providerId = text(row.providerEventId || row.provider?.eventId);
  return {
    showIds, tourDateIds,
    providerEventIds: unique([...(previous.providerEventIds || []), provider && providerId ? `${provider}:${providerId}` : ""]),
    postIds: unique([...(previous.postIds || []), text(row.postId)]),
  };
}

function descriptor(row) {
  const timing = calendarEventTiming(row);
  const ids = calendarSourceIds(row);
  const aliases = [
    ...ids.showIds.map((id) => `show:${id}`),
    ...ids.tourDateIds.map((id) => `event:${id}`),
    ...ids.providerEventIds.map((id) => `provider:${id}`),
  ];
  return {
    row, ids, aliases,
    bucket: JSON.stringify([lower(row.artist), lower(row.venue || row.place), timing.date]),
    city: lower(row.city), venueKey: lower(row.venueKey),
    instant: timing.startAt,
    clock: timing.startLocalTime,
    zone: timing.timeZone,
  };
}

function intersects(left, right) {
  return left.some((value) => right.includes(value));
}

function compatible(left, right) {
  if (left.bucket !== right.bucket) return false;
  if (left.city && right.city && left.city !== right.city) return false;
  if (left.venueKey && right.venueKey && left.venueKey !== right.venueKey) return false;
  for (const key of ["showIds", "tourDateIds"]) {
    if (left.ids[key].length && right.ids[key].length && !intersects(left.ids[key], right.ids[key])) return false;
  }
  for (const first of left.ids.providerEventIds) {
    for (const second of right.ids.providerEventIds) {
      if (first.split(":")[0] === second.split(":")[0] && first !== second) return false;
    }
  }
  if (left.instant && right.instant) return left.instant === right.instant;
  if (left.clock && right.clock && left.clock !== right.clock) return false;
  if (left.zone && right.zone && left.zone !== right.zone) return false;
  return true;
}

function groupCompatible(left, right) {
  return left.every((a) => right.every((b) => compatible(a, b)));
}

/**
 * First join exact aliases, then weak rows only when their complete candidate
 * bucket identifies one compatible performance. A legacy row cannot bridge
 * two different performances just because it was processed first.
 */
export function calendarPerformanceGroups(rows = []) {
  const values = rows.map(descriptor);
  const parents = values.map((_, index) => index);
  const root = (index) => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]];
      index = parents[index];
    }
    return index;
  };
  const aliases = new Map();
  values.forEach((value, index) => {
    for (const alias of value.aliases) {
      if (aliases.has(alias)) parents[root(index)] = root(aliases.get(alias));
      else aliases.set(alias, index);
    }
  });
  const exact = new Map();
  values.forEach((value, index) => {
    const key = root(index);
    if (!exact.has(key)) exact.set(key, []);
    exact.get(key).push(value);
  });
  const groups = [];
  const weak = new Map();
  for (const group of exact.values()) {
    const value = group[0];
    const key = JSON.stringify([value.bucket, value.city, value.venueKey, value.instant, value.clock, value.zone]);
    if (!value.aliases.length && weak.has(key)) groups[weak.get(key)].push(...group);
    else {
      if (!value.aliases.length) weak.set(key, groups.length);
      groups.push(group);
    }
  }
  // Only compare same-night buckets, so a large catalogue does not require
  // a quadratic scan across unrelated dates/artists/venues.
  const buckets = new Map();
  groups.forEach((group, index) => {
    const key = group[0].bucket;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(index);
  });
  const candidates = groups.map((group, index) => buckets.get(group[0].bucket)
    .filter((otherIndex) => otherIndex !== index && groupCompatible(group, groups[otherIndex])));
  const consumed = new Set();
  const output = [];
  groups.forEach((group, index) => {
    if (consumed.has(index)) return;
    const component = new Set([index]);
    const queue = [index];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      for (const candidate of candidates[queue[cursor]]) {
        if (!component.has(candidate)) { component.add(candidate); queue.push(candidate); }
      }
    }
    // A complete compatibility component can contain catalogue, attendance
    // and several legacy post sources. Any conflicting pair makes the whole
    // component ambiguous; weak rows cannot bridge its exact performances.
    const unambiguous = [...component].every((member) => candidates[member].length === component.size - 1);
    if (unambiguous) output.push([...component].flatMap((member) => groups[member].map(({ row }) => row)));
    else for (const member of component) output.push(groups[member].map(({ row }) => row));
    for (const member of component) consumed.add(member);
  });
  return output;
}

export function calendarPerformanceKey(row) {
  const value = descriptor(row);
  // Tour IDs persist when a provider reschedules or fixes display metadata.
  const strong = value.ids.tourDateIds[0] ? `event:${value.ids.tourDateIds[0]}`
    : value.ids.showIds[0] ? `show:${value.ids.showIds[0]}`
      : value.ids.providerEventIds[0] ? `provider:${value.ids.providerEventIds[0]}` : null;
  return strong || `legacy:${JSON.stringify([value.bucket, value.city, value.venueKey, value.instant || value.clock || ""])}`;
}
