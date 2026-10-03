// Local article continuity. The account privacy boundary removes this key on
// logout/handoff. Media descriptors retain IDs only, never private URLs/files.
export { newsroomDraftStorageKey } from "./accountLocalPrivacy.mjs";
export const NEWSROOM_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_NEWSROOM_ARTICLE_SOURCES = 10;
// All capped form strings total under 87,000 UTF-16 units. JSON can expand a
// unit to six characters; this also leaves room for property names/punctuation.
// A receipt comparison must retain its complete snapshot, never a sliced one.
const MAX_PAYLOAD_SNAPSHOT_LENGTH = 524288;
const LEGACY_SNAPSHOT_LENGTH = 100000;

export const emptyNewsroomForm = () => ({ headline: "", summary: "", body: "", category: "tour",
  sources: Array.from({ length: 3 }, () => ({ name: "", url: "" })), photo: null,
  photoName: "", photoUrl: "", photoCredit: "" });
const text = (value, limit) => typeof value === "string" ? value.slice(0, limit) : "";
const retainSnapshot = (value) => typeof value === "string" && value.length <= MAX_PAYLOAD_SNAPSHOT_LENGTH ? value : null;
const legacyTruncatedSnapshot = (value) => {
  if (typeof value !== "string" || value.length !== LEGACY_SNAPSHOT_LENGTH) return false;
  try { JSON.parse(value); return false; } catch { return true; }
};
export function newsroomDraftEnvelope(accountId, form, attempt, savedPayload = null, at = Date.now()) {
  const attemptPayload = retainSnapshot(attempt?.payload);
  const confirmedPayload = retainSnapshot(savedPayload);
  return { version: 1, accountId: String(accountId), updatedAt: at,
    form: { headline: text(form.headline, 300), summary: text(form.summary, 1200), body: text(form.body, 60000),
      category: text(form.category, 40) || "tour",
      sources: Array.from({ length: Math.min(MAX_NEWSROOM_ARTICLE_SOURCES, Math.max(3, form.sources?.length || 0)) }, (_, index) => ({
        name: text(form.sources?.[index]?.name, 160), url: text(form.sources?.[index]?.url, 2048),
      })),
      photo: /^ma_[A-Za-z0-9_-]{1,160}$/u.test(form.photo?.assetId || "") ? { assetId: form.photo.assetId } : null,
      photoName: text(form.photoName, 160), photoUrl: text(form.photoUrl, 2048), photoCredit: text(form.photoCredit, 240) },
    attempt: attempt && typeof attempt.key === "string" && attemptPayload !== null
      ? { key: text(attempt.key, 128), payload: attemptPayload } : null,
    savedPayload: legacyTruncatedSnapshot(confirmedPayload) ? null : confirmedPayload };
}
export function restoreNewsroomDraft(accountId, envelope, at = Date.now()) {
  if (!accountId || envelope?.version !== 1 || envelope.accountId !== String(accountId)
      || !Number.isFinite(envelope.updatedAt) || envelope.updatedAt > at
      || at - envelope.updatedAt >= NEWSROOM_DRAFT_TTL_MS || !envelope.form) return null;
  return newsroomDraftEnvelope(accountId, envelope.form, envelope.attempt, envelope.savedPayload, envelope.updatedAt);
}
export function newsroomArticlePayload(form) {
  return { headline: form.headline, summary: form.summary, body: form.body, category: form.category,
    sources: form.sources.slice(0, MAX_NEWSROOM_ARTICLE_SOURCES)
      .filter((source) => source.name.trim() || source.url.trim())
      .map((source) => ({ kind: "article", name: source.name, url: source.url })),
    photo: { assetId: form.photo?.assetId, name: form.photoName, url: form.photoUrl, credit: form.photoCredit } };
}
// Identical uncertain saves retry the same key; changing the submitted article
// starts a new intent. Keep confirmed keys too, so repeated clicks replay safely.
export function newsroomSaveAttempt(previous, payload, newKey) {
  const snapshot = JSON.stringify(payload);
  if (previous?.payload === snapshot) return previous;
  // Old versions sliced snapshots at 100,000 characters. A matching prefix is
  // uncertain, not evidence of equal articles: send the full payload with the
  // old key and let the server replay or reject it. Persist the full attempt so
  // a subsequent deliberate edit can start a new intent after any conflict.
  if (legacyTruncatedSnapshot(previous?.payload) && snapshot.startsWith(previous.payload)) {
    return { key: previous.key, payload: snapshot };
  }
  return { key: newKey(), payload: snapshot };
}
