export const CREATOR_UPDATE_KINDS = Object.freeze({ update: "Update", show: "Show dates", release: "Release" });
const text = value => typeof value === "string" ? value.trim() : "";

// Drafts intentionally retain incomplete fields. Validation happens before
// publishing; reopening an unfinished date must not silently erase it.
export function creatorUpdateDraft(value) {
  if (!value || !["artist", "venue", "event"].includes(value.entityType) || !text(value.entityKey)) return null;
  return { version: 1, entityType: value.entityType, entityKey: text(value.entityKey),
    kind: Object.hasOwn(CREATOR_UPDATE_KINDS, value.kind) ? value.kind : "update",
    title: text(value.title), date: text(value.date), location: text(value.location), url: text(value.url) };
}

