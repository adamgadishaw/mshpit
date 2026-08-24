export const MAX_POST_TAGGED_PEOPLE = 8;

const text = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";

function taggedUserId(value) {
  const id = text(value, 120);
  if (!id || /[\s\u0000-\u001F\u007F]/u.test(id)) return null;
  return id;
}

// A null result means the request shape is invalid. An empty array is a valid,
// explicit "remove everybody" selection. The server remains authoritative for
// whether each opaque account id exists and is currently taggable.
export function normalizeTaggedUserIds(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > MAX_POST_TAGGED_PEOPLE) return null;
  const ids = [];
  for (const raw of value) {
    const id = taggedUserId(raw);
    if (!id) return null;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function normalizeTaggedPeople(value) {
  if (!Array.isArray(value)) return [];
  const people = [];
  const seen = new Set();
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const id = taggedUserId(raw.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    people.push({
      id,
      name: text(raw.name, 80) || text(raw.handle, 20) || "Pit member",
      handle: text(raw.handle, 20),
      initials: text(raw.initials, 8) || text(raw.name, 2).toUpperCase() || "?",
      avatarUri: text(raw.avatarUri, 2_000) || null,
      avatarColor: text(raw.avatarColor, 40) || null,
      role: text(raw.role, 20) || "fan",
      verified: raw.verified === true,
    });
    if (people.length >= MAX_POST_TAGGED_PEOPLE) break;
  }
  return people;
}

export function taggedUserIdsFromPeople(value) {
  return normalizeTaggedPeople(value).map((person) => person.id);
}
