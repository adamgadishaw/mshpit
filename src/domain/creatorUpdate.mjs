import { toIsoDate } from "./dates.mjs";

import { CREATOR_UPDATE_KINDS } from "./creatorUpdateDraft.mjs";
export { CREATOR_UPDATE_KINDS, creatorUpdateDraft } from "./creatorUpdateDraft.mjs";
const text = value => typeof value === "string" ? value.trim() : "";

export function creatorUpdateError(value) {
  if (!value || value.version !== 1 || !["artist", "venue", "event"].includes(value.entityType)
    || !text(value.entityKey) || value.entityKey.length > 200 || /[\p{Cc}\p{Cf}]/u.test(value.entityKey)
    || !Object.hasOwn(CREATOR_UPDATE_KINDS, value.kind)) return "Choose a page you manage.";
  for (const [key, max] of [["title", 160], ["date", 10], ["location", 200], ["url", 2000]]) {
    if (typeof value[key] !== "string" || value[key].length > max || /[\p{Cc}\p{Cf}]/u.test(value[key])) return `Check the ${key} field.`;
  }
  if (!value.title.trim()) return "Add a title for your followers.";
  if ((value.kind === "show" && !value.date) || (value.date && (toIsoDate(value.date) !== value.date))) return "Choose a valid date (YYYY-MM-DD).";
  if (value.kind === "show" && !value.location.trim()) return "Add the venue or location for this show.";
  if (value.calendar) {
    const c = value.calendar;
    if (value.entityType !== "artist" || value.kind !== "show" || !["create", "edit", "cancel"].includes(c.action)) return "Choose an artist calendar action.";
    if (typeof c.venue !== "string" || !c.venue.trim() || typeof c.place !== "string" || !c.place.trim()) return "Add a venue, city and country.";
    if (c.action !== "create" && (!c.eventId || !Number.isSafeInteger(c.expectedRevision))) return "Choose one of your calendar shows.";
    if (!Number.isSafeInteger(c.releaseAt) || c.releaseAt < 0) return "Choose a valid publication date.";
  }
  if (value.url) {
    try {
      const url = new URL(value.url);
      if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return "Use an HTTPS ticket or release link.";
    } catch { return "Use an HTTPS ticket or release link."; }
  }
  return null;
}

export function creatorEntityForComposer(session, supplied) {
  if (!session?.id || !["artist", "venue", "event"].includes(session.role)) return null;
  if (supplied && supplied.entityType === session.role && text(supplied.entityKey)) return supplied;
  return session.role === "artist" && text(session.artistName)
    ? { entityType: "artist", entityKey: text(session.artistName).toLowerCase(), name: text(session.artistName) } : null;
}
