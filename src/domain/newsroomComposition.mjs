// Local article continuity. The account privacy boundary removes this key on
// logout/handoff. Media descriptors retain IDs only, never private URLs/files.
export const newsroomDraftStorageKey = (accountId) => accountId
  ? `pit.newsroom.draft.v1.${encodeURIComponent(String(accountId))}` : null;
export const NEWSROOM_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

export const emptyNewsroomForm = () => ({ headline: "", summary: "", body: "", category: "tour",
  sources: Array.from({ length: 3 }, () => ({ name: "", url: "" })), photo: null,
  photoName: "", photoUrl: "", photoCredit: "" });
const text = (value, limit) => typeof value === "string" ? value.slice(0, limit) : "";
export function newsroomDraftEnvelope(accountId, form, attempt, savedPayload = null, at = Date.now()) {
  return { version: 1, accountId: String(accountId), updatedAt: at,
    form: { headline: text(form.headline, 300), summary: text(form.summary, 1200), body: text(form.body, 60000),
      category: text(form.category, 40) || "tour",
      sources: Array.from({ length: 3 }, (_, index) => ({ name: text(form.sources?.[index]?.name, 160), url: text(form.sources?.[index]?.url, 2048) })),
      photo: /^ma_[A-Za-z0-9_-]{1,160}$/u.test(form.photo?.assetId || "") ? { assetId: form.photo.assetId } : null,
      photoName: text(form.photoName, 160), photoUrl: text(form.photoUrl, 2048), photoCredit: text(form.photoCredit, 240) },
    attempt: attempt && typeof attempt.key === "string" && typeof attempt.payload === "string"
      ? { key: text(attempt.key, 128), payload: text(attempt.payload, 100000) } : null,
    savedPayload: typeof savedPayload === "string" ? text(savedPayload, 100000) : null };
}
export function restoreNewsroomDraft(accountId, envelope, at = Date.now()) {
  if (!accountId || envelope?.version !== 1 || envelope.accountId !== String(accountId)
      || !Number.isFinite(envelope.updatedAt) || envelope.updatedAt > at
      || at - envelope.updatedAt >= NEWSROOM_DRAFT_TTL_MS || !envelope.form) return null;
  return newsroomDraftEnvelope(accountId, envelope.form, envelope.attempt, envelope.savedPayload, envelope.updatedAt);
}
export function newsroomArticlePayload(form) {
  return { headline: form.headline, summary: form.summary, body: form.body, category: form.category,
    sources: form.sources.map((source) => ({ kind: "article", name: source.name, url: source.url })),
    photo: { assetId: form.photo?.assetId, name: form.photoName, url: form.photoUrl, credit: form.photoCredit } };
}
// Identical uncertain saves retry the same key; changing the submitted article
// starts a new intent. Keep confirmed keys too, so repeated clicks replay safely.
export function newsroomSaveAttempt(previous, payload, newKey) {
  const snapshot = JSON.stringify(payload);
  return previous?.payload === snapshot ? previous : { key: newKey(), payload: snapshot };
}
