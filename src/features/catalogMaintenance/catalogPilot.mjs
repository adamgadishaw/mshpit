// Local-only planning and inspection. No transport, database, provider,
// credential or live-commit dependency belongs in this module.
export const PILOT_TYPES = Object.freeze(["artist", "venue", "event"]);
export const PILOT_LIMIT = 100;
export const PILOT_MAX_BYTES = 8 * 1024 * 1024;
const fields = { artist: ["origin", "active_since", "genres", "members", "website"],
  venue: ["address", "capacity", "opened", "venue_type", "also_known_as", "website"], event: ["context"] };
const statuses = new Set(["pending", "consistent", "awaiting_proposal", "conflict", "quarantined", "paused", "revoked"]);
const fail = message => { throw new Error(message); };
const object = (value, keys) => {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) {
    fail("The local pilot file contains unsupported fields.");
  }
  return value;
};
const text = (value, max, empty = false) => {
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    fail("The local pilot file contains invalid text.");
  }
  return value;
};
const integer = (value, max = Number.MAX_SAFE_INTEGER) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) fail("The local pilot file contains an invalid count or revision.");
  return value;
};
const bool = value => { if (typeof value !== "boolean") fail("The snapshot needs explicit protection and pause state."); return value; };
const hash = value => { if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) fail("The snapshot needs exact identity and value hashes."); return value; };
const url = value => {
  text(value, 1000);
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || !parsed.hostname.includes(".")
      || /^(?:localhost|.*\.local|\d+(?:\.\d+){3}|\[.*\])$/iu.test(parsed.hostname)) throw new Error();
    return parsed.href;
  } catch { return fail("Sources must be public HTTPS references without credentials."); }
};
const list = (value, max) => { if (!Array.isArray(value) || value.length > max) fail("The local pilot list exceeds its limit."); return value; };
const id = record => JSON.stringify([record.type, record.key]);
const copy = value => JSON.parse(JSON.stringify(value));
export function pilotCanonical(value) {
  if (Array.isArray(value)) return `[${value.map(pilotCanonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${pilotCanonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function content(value, type, patch = false) {
  object(value, ["version", "summary", "summarySources", "facts", "images"]);
  const result = {};
  if (value.version !== undefined) { if (value.version !== 1) fail("Unsupported findings version."); result.version = 1; }
  if (!patch || Object.hasOwn(value, "summary")) result.summary = text(value.summary, 700, true);
  if (!patch || Object.hasOwn(value, "summarySources")) result.summarySources = list(value.summarySources, 4).map(url);
  if (!patch || Object.hasOwn(value, "facts")) result.facts = list(value.facts, 8).map(fact => {
    object(fact, ["field", "value", "source"]);
    if (!fields[type].includes(fact.field)) fail("This fact does not belong to the catalog entity type.");
    return { field: fact.field, value: text(fact.value, 160), source: url(fact.source) };
  });
  if (!patch || Object.hasOwn(value, "images")) result.images = list(value.images, 3).map(value => {
    if (typeof value !== "string" || !/^https:\/\/commons\.wikimedia\.org\/wiki\/File:[^\s?#]{3,240}$/u.test(value)) fail("Images must remain Commons file-page candidates.");
    return value;
  });
  if (patch && (!Object.keys(result).length || Object.hasOwn(result, "summary") !== Object.hasOwn(result, "summarySources")
    || Object.hasOwn(result, "version") || (type === "venue" && result.facts?.some(fact => fact.field === "address")))) {
    fail("A proposal needs a supported research patch and paired summary sources.");
  }
  return result;
}
function proposal(value, type) {
  if (value == null) return null;
  object(value, ["baseRevision", "baseValueHash", "identityHash", "patch", "evidence", "actorLabel"]);
  const patch = content(value.patch, type, true);
  const evidence = list(value.evidence, 12).map(entry => {
    object(entry, ["url", "title", "accessedAt", "evidenceHash"]);
    return { url: url(entry.url), title: text(entry.title, 200), accessedAt: integer(entry.accessedAt), evidenceHash: hash(entry.evidenceHash) };
  });
  const sources = new Set(evidence.map(entry => entry.url));
  if (!evidence.length || [...(patch.summarySources || []), ...(patch.facts || []).map(fact => fact.source), ...(patch.images || [])]
    .some(source => !sources.has(source))) fail("Every changed field needs submitted source evidence.");
  return { baseRevision: integer(value.baseRevision), baseValueHash: hash(value.baseValueHash), identityHash: hash(value.identityHash),
    patch, evidence, actorLabel: text(value.actorLabel, 80) };
}
function record(value) {
  object(value, ["type", "key", "name", "revision", "valueHash", "identityHash", "eligible", "protected", "hidden", "findings", "proposal", "work"]);
  if (!PILOT_TYPES.includes(value.type)) fail("Unsupported catalog entity type.");
  if (typeof value.key !== "string" || /[\u0000-\u001f\u007f]/u.test(value.key)) fail("Use the exact catalog identity key without control characters.");
  const result = { type: value.type, key: text(value.key, 600), name: text(value.name, 200), revision: integer(value.revision),
    valueHash: hash(value.valueHash), identityHash: hash(value.identityHash), eligible: bool(value.eligible),
    protected: bool(value.protected), hidden: bool(value.hidden), findings: value.findings == null ? null : content(value.findings, value.type),
    proposal: proposal(value.proposal, value.type) };
  object(value.work, ["status", "revision", "leaseUntil"]);
  if (!["available", "leased", "proposed", "quarantined"].includes(value.work.status)) fail("Unsupported snapshot work state.");
  result.work = { status: value.work.status, revision: integer(value.work.revision), leaseUntil: integer(value.work.leaseUntil) };
  return result;
}
export function validatePilotSnapshot(value) {
  object(value, ["version", "kind", "sourceId", "capturedAt", "coverage", "totals", "control", "records"]);
  if (value.version !== 1 || !["synthetic", "authorized-catalog-snapshot"].includes(value.kind)
    || !["complete", "sample"].includes(value.coverage)) fail("Use a versioned synthetic or authorized catalog-only snapshot.");
  object(value.control, ["paused", "revision", "grantStatus"]);
  if (!["not_connected", "active", "revoked", "expired"].includes(value.control.grantStatus)) fail("The snapshot needs a known grant status.");
  object(value.totals, PILOT_TYPES);
  const totals = Object.fromEntries(PILOT_TYPES.map(type => [type, value.totals[type] == null ? null : integer(value.totals[type], 10_000_000)]));
  const records = list(value.records, 1000).map(record), seen = new Set();
  for (const row of records) { if (seen.has(id(row))) fail("Duplicate catalog identities need reconciliation before selection."); seen.add(id(row)); }
  for (const type of PILOT_TYPES) {
    const observed = records.filter(row => row.type === type).length;
    if (totals[type] != null && (totals[type] < observed || (value.coverage === "complete" && totals[type] !== observed))) {
      fail("Inventory totals conflict with the supplied snapshot.");
    }
  }
  return { version: 1, kind: value.kind, sourceId: text(value.sourceId, 100), capturedAt: integer(value.capturedAt), coverage: value.coverage,
    totals, control: { paused: bool(value.control.paused), revision: integer(value.control.revision), grantStatus: value.control.grantStatus }, records };
}
export function parsePilotFile(input) {
  if (typeof input !== "string" || pilotBytes(input) > PILOT_MAX_BYTES) fail("The local pilot file is too large.");
  let value;
  try { value = JSON.parse(input); } catch { return fail("The local pilot file must be valid JSON."); }
  return value?.kind === "catalog-pilot-dry-run" ? validatePilotReport(value) : validatePilotSnapshot(value);
}
export function pilotBytes(value) {
  let bytes = 0;
  for (const character of value) {
    const code = character.codePointAt(0);
    bytes += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4;
  }
  return bytes;
}
export function serializePilotReport(input) {
  const encoded = JSON.stringify(validatePilotReport(input));
  if (pilotBytes(encoded) > PILOT_MAX_BYTES) fail("The checkpoint is too large. Supply a smaller catalog snapshot.");
  return encoded;
}
const eligible = row => row.eligible && !row.protected && !row.hidden && row.work.status !== "quarantined";
const binding = row => ({ revision: row.revision, valueHash: row.valueHash, identityHash: row.identityHash,
  name: row.name, findings: row.findings, proposal: row.proposal, work: row.work });
export function createPilotReport(input, limit = PILOT_LIMIT) {
  const snapshot = validatePilotSnapshot(input);
  integer(limit, PILOT_LIMIT); if (!limit) fail("Choose one to 100 pilot records.");
  const queues = PILOT_TYPES.map(type => snapshot.records.filter(row => row.type === type && eligible(row))
    .sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const selected = [];
  while (selected.length < limit && queues.some(queue => queue.length)) {
    for (const queue of queues) if (queue.length && selected.length < limit) {
      const row = queue.shift(); selected.push({ type: row.type, key: row.key, base: binding(row), status: "pending", checked: null });
    }
  }
  return { version: 1, kind: "catalog-pilot-dry-run", snapshot, observed: snapshot, evaluatedAt: snapshot.capturedAt,
    limit, revision: 0, paused: false, selected };
}
export function validatePilotReport(value) {
  object(value, ["version", "kind", "snapshot", "observed", "evaluatedAt", "limit", "revision", "paused", "selected"]);
  if (value.version !== 1 || value.kind !== "catalog-pilot-dry-run") fail("Unsupported local checkpoint.");
  const original = createPilotReport(value.snapshot, value.limit);
  const observed = validatePilotSnapshot(value.observed);
  const evaluatedAt = integer(value.evaluatedAt);
  if (evaluatedAt < observed.capturedAt) fail("The checkpoint predates its latest observation.");
  if (observed.kind !== original.snapshot.kind || observed.sourceId !== original.snapshot.sourceId
    || observed.capturedAt < original.snapshot.capturedAt || observed.control.revision < original.snapshot.control.revision) {
    fail("The checkpoint observation is older than its selection or belongs to a different snapshot source.");
  }
  const observedRows = new Map(observed.records.map(row => [id(row), row]));
  if (list(value.selected, PILOT_LIMIT).length !== original.selected.length) fail("The checkpoint selection has changed.");
  const selected = value.selected.map((row, index) => {
    object(row, ["type", "key", "base", "status", "checked"]);
    const expected = original.selected[index];
    if (id(row) !== id(expected) || pilotCanonical(row.base) !== pilotCanonical(expected.base) || !statuses.has(row.status)) {
      fail("The checkpoint does not match its source identities and proposals.");
    }
    let checked = null;
    if (row.status !== "pending") {
      object(row.checked, ["record", "sourceId", "kind", "control", "capturedAt", "at"]);
      const observation = validatePilotSnapshot({ version: 1, sourceId: row.checked.sourceId, kind: row.checked.kind,
        capturedAt: row.checked.capturedAt, control: row.checked.control, coverage: "sample",
        totals: { artist: null, venue: null, event: null }, records: row.checked.record ? [row.checked.record] : [] });
      checked = { record: observation.records[0] || null, sourceId: observation.sourceId, kind: observation.kind,
        control: observation.control, capturedAt: observation.capturedAt, at: integer(row.checked.at) };
      if ((checked.record && id(checked.record) !== id(expected))
        || pilotCanonical(checked.record) !== pilotCanonical(observedRows.get(id(expected)) || null)
        || checked.sourceId !== observed.sourceId || checked.kind !== observed.kind || checked.capturedAt !== observed.capturedAt
        || pilotCanonical(checked.control) !== pilotCanonical(observed.control)
        || checked.at > evaluatedAt || checked.at < observed.capturedAt
        || resultStatus(expected, checked.record, observation, original.snapshot, evaluatedAt) !== row.status) {
        fail("Checkpoint status is unsupported by its recorded observation.");
      }
    } else if (row.checked !== null) fail("Pending work cannot claim a completed local check.");
    return { ...expected, status: row.status, checked };
  });
  return { ...original, observed, evaluatedAt, revision: integer(value.revision), paused: bool(value.paused), selected };
}
function resultStatus(entry, current, snapshot, original, at) {
  if (["revoked", "expired"].includes(snapshot.control.grantStatus)) return "revoked";
  if (snapshot.control.paused) return "paused";
  if (!current || snapshot.kind !== original.kind || snapshot.sourceId !== original.sourceId
    || snapshot.control.revision !== original.control.revision) return "conflict";
  if (!eligible(current)) return "quarantined";
  if (pilotCanonical(binding(current)) !== pilotCanonical(entry.base)
    || (["leased", "proposed"].includes(current.work.status) && current.work.leaseUntil > at)) return "conflict";
  const proposed = current.proposal;
  if (!proposed) return "awaiting_proposal";
  if (proposed.baseRevision !== current.revision || proposed.baseValueHash !== current.valueHash || proposed.identityHash !== current.identityHash) return "conflict";
  if (proposed.evidence.some(source => source.accessedAt > at || source.accessedAt < at - 30 * 86_400_000)) return "awaiting_proposal";
  return "consistent";
}
export function advancePilotReport(input, { snapshot: supplied, batchSize = 25, expectedRevision, at = Date.now() } = {}) {
  const report = validatePilotReport(input), snapshot = supplied ? validatePilotSnapshot(supplied) : report.observed;
  if (expectedRevision !== report.revision) fail("The local preview changed. Reload its checkpoint before retrying.");
  integer(batchSize, PILOT_LIMIT); if (!batchSize && !supplied) fail("Choose a positive local batch size."); integer(at);
  const evaluatedAt = Math.max(at, report.evaluatedAt);
  if (evaluatedAt < snapshot.capturedAt) fail("The snapshot observation is in the future.");
  if (snapshot.kind !== report.observed.kind || snapshot.sourceId !== report.observed.sourceId
    || snapshot.capturedAt < report.observed.capturedAt || snapshot.control.revision < report.observed.control.revision
    || (snapshot.capturedAt === report.observed.capturedAt && pilotCanonical(snapshot) !== pilotCanonical(report.observed))) {
    fail("Supply a newer observation from the same catalog snapshot source.");
  }
  if (["revoked", "expired"].includes(report.observed.control.grantStatus)
    && !["revoked", "expired"].includes(snapshot.control.grantStatus)) {
    fail("A revoked or expired snapshot grant cannot resume this selection. Start a new preview with new authority evidence.");
  }
  if (snapshot.control.paused !== report.observed.control.paused
    && snapshot.control.revision <= report.observed.control.revision) {
    fail("A pause change needs a newer control revision.");
  }
  const rows = new Map(snapshot.records.map(row => [id(row), row]));
  let processed = 0, changed = evaluatedAt !== report.evaluatedAt || pilotCanonical(snapshot) !== pilotCanonical(report.observed);
  const selected = report.selected.map(entry => {
    // Already inspected previews must also lose readiness when newer evidence,
    // protection, claims, pause or revocation changes. No previous ready count
    // is treated as authority to write.
    const current = rows.get(id(entry)) || null;
    const next = resultStatus(entry, current, snapshot, report.snapshot, evaluatedAt);
    if (entry.status === "pending" && (processed >= batchSize || report.paused)) return entry;
    if (entry.status === "pending") processed++;
    const checked = { record: current, sourceId: snapshot.sourceId, kind: snapshot.kind,
      control: snapshot.control, capturedAt: snapshot.capturedAt, at: evaluatedAt };
    const sameObservation = entry.checked && pilotCanonical({ ...entry.checked, at: 0 }) === pilotCanonical({ ...checked, at: 0 });
    if (entry.status === next && sameObservation) return entry;
    changed = true;
    return { ...entry, status: next, checked };
  });
  return changed ? { ...report, observed: snapshot, evaluatedAt, selected, revision: report.revision + 1 } : report;
}
export function pausePilotReport(input, paused, expectedRevision) {
  const report = validatePilotReport(input); bool(paused);
  if (expectedRevision !== report.revision) fail("The local preview changed. Reload its checkpoint before retrying.");
  return report.paused === paused ? report : { ...report, paused, revision: report.revision + 1 };
}
export function pilotSummary(input) {
  const report = validatePilotReport(input), counts = Object.fromEntries([...statuses].map(status => [status, 0]));
  for (const row of report.selected) counts[row.status]++;
  return { selected: report.selected.length, examined: report.selected.length - counts.pending, ...counts,
    byType: Object.fromEntries(PILOT_TYPES.map(type => [type, report.selected.filter(row => row.type === type).length])),
    inventory: Object.fromEntries(PILOT_TYPES.map(type => [type, { observed: report.snapshot.records.filter(row => row.type === type).length,
      eligible: report.snapshot.records.filter(row => row.type === type && eligible(row)).length, reportedTotal: report.snapshot.totals[type] }])),
    confidence: report.snapshot.kind === "synthetic" ? "Synthetic fixture only" : report.snapshot.coverage === "complete"
      ? "Complete within supplied snapshot; live total unverified" : "Sample only; live total unverified",
    humanApproval: "not_recorded", liveProposalValidation: "not_performed", consistentMeaning: "snapshot_bindings_consistent",
    liveClaims: 0, liveWrites: 0, providerCalls: 0, evaluatedAt: report.evaluatedAt,
    observedAt: report.observed.capturedAt, control: copy(report.observed.control), previewPaused: report.paused };
}
export function pilotRowView(entry) {
  const current = (entry.checked ? entry.checked.record?.findings : entry.base.findings)
    || { version: 1, summary: "", summarySources: [], facts: [], images: [] };
  return { type: entry.type, key: entry.key, name: entry.base.name, status: entry.status, current: copy(current),
    proposed: entry.base.proposal ? { ...copy(current), ...copy(entry.base.proposal.patch) } : null,
    evidence: copy(entry.base.proposal?.evidence || []), actorLabel: entry.base.proposal?.actorLabel || "No proposal supplied",
    attribution: "Assistant submission; human approval not recorded", imageState: "Candidates only; no photos attached",
    eventState: entry.type === "event" ? "Stored enrichment would still need public rendering" : null };
}
export function syntheticPilotSnapshot(at = Date.now()) {
  const records = PILOT_TYPES.flatMap((type, typeIndex) => Array.from({ length: 42 }, (_, index) => {
    const key = `synthetic-${type}-${String(index).padStart(3, "0")}`, name = `Synthetic ${type} ${index}`;
    const identityHash = (typeIndex * 1000 + index + 1).toString(16).padStart(64, "0"), valueHash = "e".repeat(64);
    const source = `https://example.invalid/${key}`;
    return { type, key, name, revision: 0, valueHash, identityHash, eligible: index < 40, protected: index >= 40, hidden: false,
      findings: null, work: { status: "available", revision: 0, leaseUntil: 0 }, proposal: { baseRevision: 0, baseValueHash: valueHash,
        identityHash, actorLabel: "Synthetic assistant", patch: { summary: `${name} is a synthetic catalog record used only to demonstrate local pilot review without publishing or contacting a provider.`,
          summarySources: [source], facts: [], images: [] }, evidence: [{ url: source, title: "Synthetic evidence fixture", accessedAt: at, evidenceHash: "a".repeat(64) }] } };
  }));
  return { version: 1, kind: "synthetic", sourceId: "synthetic-pilot-v1", capturedAt: at, coverage: "complete",
    totals: { artist: 42, venue: 42, event: 42 }, control: { paused: false, revision: 0, grantStatus: "not_connected" }, records };
}
