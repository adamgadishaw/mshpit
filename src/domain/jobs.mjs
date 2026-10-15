export const JOB_FIELDS = Object.freeze(["title", "location", "arrangement", "description", "application"]);
export function jobApplicationHref(value) {
  const text = String(value || "").trim();
  if (/^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(text)) return `mailto:${text}`;
  try {
    const url = new URL(text);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
export function normalizeJobDraft(input) {
  const draft = {};
  for (const field of JOB_FIELDS) {
    const value = input?.[field];
    if (typeof value !== "string" || value.length > (field === "description" ? 12000 : field === "application" ? 2048 : 160)) throw new TypeError("Check the job fields and their lengths.");
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) throw new TypeError("Remove control characters from the job fields.");
    draft[field] = value.trim();
  }
  return draft;
}
export function jobPublishable(draft) {
  return JOB_FIELDS.every(field => !!draft[field]) && !!jobApplicationHref(draft.application);
}
