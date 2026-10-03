import { ApiError } from "../../errors.js";
import { assertSafeAuthoredText } from "../../contentSafety.js";
import { CATALOG_LIMITS, catalogObject } from "../catalogApi/catalogApiPolicy.js";
import { CATALOG_RESEARCH_FACTS, httpsUrl, sourceKey, validateCatalogResearchFindings } from "./catalogResearchFindings.js";
import { catalogFindings } from "../catalogApi/catalogApiInventory.js";
import { resolveCatalogAttachments } from "./catalogPhotoAttachments.js";

export function validateCatalogProposal(input, snapshot, at, photoOptions) {
  catalogObject(input, ["patch", "evidence"]);
  const patch = catalogObject(input.patch, ["summary", "summarySources", "facts", "images", "attachments"]);
  const evidence = input.evidence;
  if (!Array.isArray(evidence) || evidence.length < 1 || evidence.length > 12
    || Buffer.byteLength(JSON.stringify(input), "utf8") > CATALOG_LIMITS.proposalBytes) {
    throw new ApiError(400, "Supply bounded source evidence for this proposal.", "VALIDATION_FAILED");
  }
  const sources = evidence.map(entry => {
    catalogObject(entry, ["url", "title", "accessedAt", "evidenceHash"]);
    const url = httpsUrl(entry.url);
    if (!url || url.length > 1000 || typeof entry.title !== "string" || !entry.title.trim() || entry.title.length > 200
      || !Number.isSafeInteger(entry.accessedAt) || entry.accessedAt > at || entry.accessedAt < at - 30 * 86_400_000
      || !/^[a-f0-9]{64}$/u.test(entry.evidenceHash || "")) {
      throw new ApiError(400, "The source evidence is invalid or outdated.", "VALIDATION_FAILED");
    }
    return { url, title: entry.title.trim(), accessedAt: entry.accessedAt, evidenceHash: entry.evidenceHash,
      verification: "submitted" };
  });
  if (!Object.keys(patch).length || Object.hasOwn(patch, "summary") !== Object.hasOwn(patch, "summarySources")) {
    throw new ApiError(400, "A summary needs its sources in the same patch.", "VALIDATION_FAILED");
  }
  if (Object.hasOwn(patch, "summary") && (typeof patch.summary !== "string" || patch.summary.length > 700)) {
    throw new ApiError(400, "Use a concise catalog summary.", "VALIDATION_FAILED");
  }
  if (Object.hasOwn(patch, "facts") && (!Array.isArray(patch.facts) || patch.facts.length > 8
    || patch.facts.some(fact => !fact || !Object.hasOwn(CATALOG_RESEARCH_FACTS[snapshot.type], fact.field)
      || typeof fact.value !== "string" || fact.value.length > 160))) {
    throw new ApiError(400, "This entity's fact patch is invalid.", "VALIDATION_FAILED");
  }
  for (const fact of patch.facts || []) catalogObject(fact, ["field", "value", "source"]);
  if (Object.hasOwn(patch, "summarySources") && (!Array.isArray(patch.summarySources)
    || patch.summarySources.length < 1 || patch.summarySources.length > 4)) {
    throw new ApiError(400, "A summary needs one to four sources.", "VALIDATION_FAILED");
  }
  // Provider fields are read-only. Venue address is already authoritative in
  // the event catalogue; event facts have their own non-provider schema.
  if (snapshot.type === "venue" && patch.facts?.some(fact => fact.field === "address")) {
    throw new ApiError(400, "Provider venue addresses cannot be patched.", "VALIDATION_FAILED");
  }
  // A new patch cannot adopt legacy/unbound text or content from another
  // identity. Fresh summary evidence is then required; old facts stay absent.
  const bound = (snapshot.findings?.provenance?.identityHash || snapshot.findings?.identityHash) === snapshot.identityHash;
  const existing = (bound && catalogFindings(snapshot.type, snapshot.findings)) || { version: 1, summary: "", summarySources: [], facts: [], images: [] };
  const attachments = Object.hasOwn(patch, "attachments") ? resolveCatalogAttachments(snapshot, patch.attachments, photoOptions) : null;
  const merged = { ...existing, ...patch, match: "confident" };
  const urls = [...sources.map(entry => entry.url), ...(existing.summarySources || []), ...(existing.facts || []).map(fact => fact.source)];
  const checked = validateCatalogResearchFindings(merged, { type: snapshot.type, name: snapshot.identity.name, searchedUrls: urls });
  if (!checked.ok || (patch.facts && checked.record.facts.length !== patch.facts.length)
    || (patch.images && (!Array.isArray(patch.images) || checked.record.images.length !== patch.images.length))) {
    throw new ApiError(400, "The catalog proposal needs valid, cited fields.", "VALIDATION_FAILED");
  }
  const supplied = new Set(sources.map(source => sourceKey(source.url)));
  const newlyCited = [...(patch.summarySources || []), ...(patch.facts || []).map(fact => fact.source), ...(patch.images || []),
    ...(attachments || []).map(photo => photo.sourcePage)];
  if (newlyCited.some(url => !supplied.has(sourceKey(url)))) {
    throw new ApiError(400, "Every changed field needs submitted source evidence.", "VALIDATION_FAILED");
  }
  assertSafeAuthoredText(checked.record.summary, { field: "catalog summary" });
  for (const fact of checked.record.facts) assertSafeAuthoredText(fact.value, { field: "catalog fact" });
  const record = { ...existing };
  for (const field of Object.keys(patch)) record[field] = field === "attachments" ? attachments : checked.record[field];
  if (!attachments && bound && snapshot.findings?.attachments) record.attachments = snapshot.findings.attachments;
  return { patch, evidence: sources, record };
}
