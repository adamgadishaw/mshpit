import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { ApiError } from "../../errors.js";
import { catalogDigest, ensureCatalogEditorSchema, listCatalogEditorEntities, readCatalogEditorEntity } from "./catalogEditorRepository.js";
import { catalogCompletion, shortCatalogSummary } from "./catalogCompletion.js";

const fail = message => { throw new ApiError(400, message, "VALIDATION_FAILED"); };
const object = value => value && typeof value === "object" && !Array.isArray(value);
const fields = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key));
export function catalogEditorSource(value) {
  if (!fields(value, ["label", "url"]) || typeof value.label !== "string" || !value.label.trim() || value.label.length > 120
    || typeof value.url !== "string" || value.url.length > 1000 || /[\s\u0000-\u001f\u007f]/u.test(value.url)) fail("Use a source name and a public HTTPS page URL.");
  let url;
  try { url = new URL(value.url); } catch { fail("The source URL is invalid."); }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.port || isIP(host) || !host.includes(".")
    || /(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion)$/u.test(host)) fail("Use a public HTTPS source without credentials or a custom port.");
  url.hash = "";
  return { label: value.label.trim(), url: url.href };
}

export function createCatalogEditorService({ database, now = Date.now, photoReaders }) {
  ensureCatalogEditorSchema(database);
  const read = ({ type, key, completion = false }) => {
    const entity = readCatalogEditorEntity(database, { type, key, at: now() });
    if (!entity) throw new ApiError(404, "This public catalog identity is unavailable or ambiguous.", "NOT_FOUND");
    return completion ? { ...entity, completion: catalogCompletion(database, entity, photoReaders) } : entity;
  };
  const normalize = input => {
    if (!fields(input, ["type", "key", "expectedRevision", "expectedHash", "summary", "sources", "reason", "hidden", "completionHash"])) fail("Choose supported catalog text fields only.");
    if (!["artist", "venue", "event"].includes(input.type) || typeof input.key !== "string" || !input.key || input.key.length > 450
      || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || !/^[a-f0-9]{64}$/.test(input.expectedHash || "")) fail("Reload the current catalog record before preparing a change.");
    if (typeof input.summary !== "string" || !input.summary.trim() || input.summary.length > 2400
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(input.summary)) fail("Enter sourced plain text within 2,400 characters.");
    if (!Array.isArray(input.sources) || !input.sources.length || input.sources.length > 12) fail("Attach named sources within the source payload limit.");
    if (typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 300) fail("Enter a short reason for the change.");
    if (input.hidden !== undefined && typeof input.hidden !== "boolean") fail("Choose a valid publication state.");
    if (input.completionHash !== undefined && (!["artist", "venue"].includes(input.type) || !/^[a-f0-9]{64}$/u.test(input.completionHash)
      || input.hidden || !shortCatalogSummary(input.summary))) fail("Completion drafts need one or two complete sourced sentences within 700 characters.");
    const sources = input.sources.map(catalogEditorSource);
    if (new Set(sources.map(source => source.url)).size !== sources.length) fail("Remove duplicate source links.");
    return { type: input.type, key: input.key, expectedRevision: input.expectedRevision, expectedHash: input.expectedHash,
      summary: input.summary.trim(), sources, reason: input.reason.trim(), hidden: input.hidden === true,
      ...(input.completionHash ? { completionHash: input.completionHash } : {}) };
  };
  const check = draft => {
    const current = read(draft);
    if (current.protectedReason) throw new ApiError(409, current.protectedReason, "CONFLICT");
    if (current.revision !== draft.expectedRevision || current.expectedHash !== draft.expectedHash) {
      throw new ApiError(409, "The page or its saved text changed. Reload and review your draft again.", "CONFLICT");
    }
    if (draft.completionHash) {
      const plan = catalogCompletion(database, current, photoReaders);
      if (!plan.canDraft || plan.hash !== draft.completionHash || plan.photoStatus !== "accepted") {
        throw new ApiError(409, "Completion evidence changed or an accepted photo is missing. Reload and review this page.", "CONFLICT");
      }
    }
    return current;
  };
  const prepare = entries => {
    if (!Array.isArray(entries) || !entries.length || entries.length > 10) fail("Prepare between one and ten catalog records.");
    const seen = new Set();
    return { results: entries.map((entry, index) => {
      try {
        const draft = normalize(entry), key = JSON.stringify([draft.type, draft.key]);
        if (seen.has(key)) fail("Each catalog record can appear only once in a batch.");
        seen.add(key);
        const current = check(draft);
        return { index, ok: true, draft, current, payloadHash: catalogDigest(draft) };
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        return { index, ok: false, code: error.code, error: error.message };
      }
    }) };
  };
  const save = ({ actorId, draft: input, idempotencyKey, requestId = null }) => {
    const draft = normalize(input);
    if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9_-]{16,100}$/.test(idempotencyKey)) fail("A valid save receipt key is required.");
    const hash = catalogDigest(draft);
    database.exec("SAVEPOINT catalog_editor_save");
    try {
      const receipt = database.prepare("SELECT * FROM catalog_editor_receipts WHERE actor_id=? AND operation_key=?").get(actorId, idempotencyKey);
      if (receipt) {
        if (receipt.payload_hash !== hash) throw new ApiError(409, "This save key belongs to a different change.", "CONFLICT");
        database.exec("RELEASE catalog_editor_save");
        return { ...JSON.parse(receipt.receipt), replayed: true };
      }
      const before = check(draft), at = now(), revision = before.revision + 1;
      database.prepare(`INSERT INTO catalog_editor_entries(entity_type,entity_key,revision,identity_hash,summary,sources,hidden,updated_by,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(entity_type,entity_key) DO UPDATE SET revision=excluded.revision,
        identity_hash=excluded.identity_hash,summary=excluded.summary,sources=excluded.sources,hidden=excluded.hidden,
        updated_by=excluded.updated_by,updated_at=excluded.updated_at`).run(draft.type, draft.key, revision, before.identityHash,
        draft.summary, JSON.stringify(draft.sources), Number(draft.hidden), actorId, at);
      const after = read(draft), auditId = randomUUID();
      database.prepare(`INSERT INTO moderation_actions(id,actor_id,action,target_type,target_id,reason,prior_state,next_state,request_id,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).run(auditId, actorId, "catalog_text_save", "catalog", JSON.stringify([draft.type, draft.key]),
        draft.reason, JSON.stringify({ revision: before.revision, identityHash: before.identityHash, content: before.content }),
        JSON.stringify({ revision, identityHash: after.identityHash, content: after.content }), requestId, at);
      const result = { ok: true, revision, auditId, saved: after, replayed: false };
      database.prepare("INSERT INTO catalog_editor_receipts VALUES(?,?,?,?,?)").run(actorId, idempotencyKey, hash, JSON.stringify(result), at);
      // Bound cleanup work; old receipts have a seven-day retry window.
      database.prepare("DELETE FROM catalog_editor_receipts WHERE rowid IN (SELECT rowid FROM catalog_editor_receipts WHERE created_at<? LIMIT 64)").run(at - 7 * 86400_000);
      database.exec("RELEASE catalog_editor_save");
      return result;
    } catch (error) {
      database.exec("ROLLBACK TO catalog_editor_save; RELEASE catalog_editor_save");
      throw error;
    }
  };
  return { read, prepare, save, list: options => {
    const page = listCatalogEditorEntities(database, { ...options, at: now(), ...(options.completion ? { missingOnly: false, limit: 10 } : {}) });
    return options.completion ? { ...page, items: page.items.map(entity => ({ ...entity, completion: catalogCompletion(database, entity, photoReaders) })) } : page;
  } };
}
