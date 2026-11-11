import { ApiError } from "../../errors.js";
import { createPublicDocumentRepository } from "../seo/publicDocumentRepository.js";

// Registry keys reference existing public identities; they never create a
// second event catalog or reinterpret analytics `events` as concert records.
export function createEventAccountTargetReader(db) {
  const publicPages = createPublicDocumentRepository(db);
  return (kind, id) => {
    if (!["event", "festival"].includes(kind) || typeof id !== "string" || !id || id !== id.trim()
      || id.length > 180 || (kind === "festival" && !/^[a-z0-9-]{1,80}$/u.test(id)) || /[\p{Cc}\p{Cf}]/u.test(id)) throw new ApiError(400, "Choose an existing event or festival page.", "VALIDATION_FAILED");
    const row = kind === "festival"
      ? db.prepare("SELECT slug,name FROM festivals WHERE slug=?").get(id)
      : publicPages.readEvent({ id, relatedLimit: 1 })?.event;
    if (!row) throw new ApiError(404, "That event or festival page is unavailable.", "NOT_FOUND");
    return { entityType: "event", entityKey: `${kind}:${kind === "festival" ? row.slug : row.id}`,
      name: kind === "festival" ? row.name : row.event_name || row.artist,
      targetKind: kind, targetId: kind === "festival" ? row.slug : row.id };
  };
}
