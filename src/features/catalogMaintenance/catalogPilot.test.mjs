import assert from "node:assert/strict";
import test from "node:test";
import { PILOT_MAX_BYTES, advancePilotReport, createPilotReport, parsePilotFile, pausePilotReport, pilotBytes,
  pilotRowView, pilotSummary, serializePilotReport, syntheticPilotSnapshot, validatePilotReport, validatePilotSnapshot } from "./catalogPilot.mjs";
const at = 1_790_000_000_000;
const copy = value => structuredClone(value);
const start = () => createPilotReport(syntheticPilotSnapshot(at));
const advance = (report, extra = {}) => advancePilotReport(report, { expectedRevision: report.revision, at, ...extra });

test("pilot selects at most 100 distinct existing eligible records with deterministic type coverage", () => {
  const report = start(), summary = pilotSummary(report);
  assert.deepEqual(summary.byType, { artist: 34, venue: 33, event: 33 });
  assert.equal(summary.selected, 100); assert.equal(summary.examined, 0); assert.equal(summary.pending, 100);
  assert.equal(new Set(report.selected.map(row => `${row.type}:${row.key}`)).size, 100);
  assert.ok(report.selected.every(row => report.snapshot.records.some(item => item.type === row.type && item.key === row.key && !item.protected)));
  const shuffled = copy(report.snapshot); shuffled.records.reverse();
  assert.deepEqual(createPilotReport(shuffled).selected, report.selected);
  for (const limit of [0, 101, 1.5, -1]) assert.throws(() => createPilotReport(report.snapshot, limit));
  const small = copy(report.snapshot); small.records = small.records.filter(row => row.type === "event").slice(0, 3);
  small.totals = { artist: 0, venue: 0, event: 3 };
  assert.equal(createPilotReport(small).selected.length, 3);
});
test("inventory confidence describes only supplied evidence and never fabricates live work or human review", () => {
  const snapshot = syntheticPilotSnapshot(at); snapshot.kind = "authorized-catalog-snapshot"; snapshot.coverage = "sample";
  snapshot.totals = { artist: 60000, venue: null, event: null };
  const summary = pilotSummary(createPilotReport(snapshot));
  assert.match(summary.confidence, /Sample only; live total unverified/);
  assert.deepEqual([summary.liveClaims, summary.liveWrites, summary.providerCalls], [0, 0, 0]);
  assert.equal(summary.humanApproval, "not_recorded");
  assert.equal(summary.inventory.artist.observed, 42);
  assert.equal(summary.inventory.artist.reportedTotal, 60000);
});
test("batches resume exact selection, reject stale revisions and do not double-count completed checks", () => {
  let report = advance(start());
  assert.equal(pilotSummary(report).examined, 25);
  const firstSelection = copy(report.selected.map(row => [row.type, row.key]));
  assert.throws(() => advancePilotReport(report, { expectedRevision: 0, at }), /changed/);
  report = parsePilotFile(serializePilotReport(report));
  for (let index = 0; index < 3; index++) report = advance(report);
  assert.equal(pilotSummary(report).consistent, 100);
  assert.deepEqual(report.selected.map(row => [row.type, row.key]), firstSelection);
  assert.deepEqual(advance(report), report);
  assert.equal(pilotSummary(report).liveWrites, 0);
});
test("new claim, protection, identity or proposal observations invalidate an inspected preview", () => {
  for (const [change, status] of [
    [row => { row.work = { status: "leased", revision: 1, leaseUntil: at + 1000 }; }, "conflict"],
    [row => { row.protected = true; }, "quarantined"],
    [row => { row.hidden = true; }, "quarantined"],
    [row => { row.identityHash = "f".repeat(64); }, "conflict"],
    [row => { row.revision++; }, "conflict"],
    [row => { row.proposal.patch.summary += " Changed."; }, "conflict"],
  ]) {
    const report = advance(start()), snapshot = copy(report.observed); snapshot.capturedAt++;
    change(snapshot.records[0]);
    const updated = advance(report, { snapshot, batchSize: 0, at: at + 1 });
    assert.equal(updated.selected[0].status, status);
    assert.equal(pilotSummary(updated).examined, 25);
    const resumed = advance(updated, { at: at + 2 });
    assert.equal(resumed.selected[0].status, status, "resume must keep the latest observation");
    assert.throws(() => advance(resumed, { snapshot: report.snapshot, at: at + 2 }), /newer observation/);
  }
});
test("pause and revocation recheck prior results and survive checkpoint reload", () => {
  const report = advance(start());
  for (const control of [{ paused: true, revision: 1, grantStatus: "active" }, { paused: false, revision: 1, grantStatus: "revoked" }]) {
    const snapshot = copy(report.snapshot); snapshot.capturedAt++; snapshot.control = control;
    const paused = pausePilotReport(report, true, report.revision);
    const changed = advance(paused, { snapshot, batchSize: 0, at: at + 1 });
    assert.equal(changed.selected[0].status, control.paused ? "paused" : "revoked");
    assert.equal(pilotSummary(changed).examined, 25);
    const resumed = pausePilotReport(parsePilotFile(serializePilotReport(changed)), false, changed.revision);
    assert.equal(advance(resumed, { at: at + 2 }).selected[0].status, control.paused ? "paused" : "revoked");
  }
  assert.equal(pilotSummary(advance(pausePilotReport(start(), true, 0))).examined, 0);
});
test("terminal grant observations cannot revive and pause transitions need a new control generation", () => {
  let report = advance(start());
  const revoked = copy(report.observed); revoked.capturedAt++; revoked.control.grantStatus = "revoked";
  report = advance(report, { snapshot: revoked, at: at + 1 });
  const revived = copy(revoked); revived.capturedAt++; revived.control.grantStatus = "active"; revived.control.revision++;
  assert.throws(() => advance(report, { snapshot: revived, at: at + 2 }), /cannot resume/);
  const paused = copy(start().snapshot); paused.capturedAt++; paused.control.paused = true;
  assert.throws(() => advance(start(), { snapshot: paused, at: at + 1 }), /newer control revision/);
  const summary = pilotSummary(report);
  assert.equal(summary.liveProposalValidation, "not_performed");
  assert.equal(summary.consistentMeaning, "snapshot_bindings_consistent");
});
test("wall-clock rollback cannot restore expired evidence or rewrite the evaluation watermark", () => {
  const expiredAt = at + 31 * 86400000;
  const expired = advance(start(), { batchSize: 100, at: expiredAt });
  assert.equal(pilotSummary(expired).awaiting_proposal, 100);
  const retried = advance(parsePilotFile(serializePilotReport(expired)), { at: at + 1 });
  assert.equal(retried.evaluatedAt, expiredAt);
  assert.equal(pilotSummary(retried).awaiting_proposal, 100);
});
test("missing proposals, stale evidence and active work never count as consistent", () => {
  const snapshot = syntheticPilotSnapshot(at);
  snapshot.records[0].proposal = null;
  snapshot.records[1].proposal.evidence[0].accessedAt = at - 31 * 86400000;
  snapshot.records[2].work = { status: "proposed", revision: 0, leaseUntil: at + 1000 };
  const report = advance(createPilotReport(snapshot), { batchSize: 100 });
  assert.equal(pilotSummary(report).awaiting_proposal, 2);
  assert.equal(pilotSummary(report).conflict, 1);
  assert.equal(pilotSummary(report).consistent, 97);
});
test("checkpoint status, selection and observations cannot be replaced with unsupported counters or approvals", () => {
  const original = advance(start());
  for (const change of [
    report => { report.selected[0].key = "invented"; },
    report => { report.selected[0].status = "approved"; },
    report => { report.selected[0].checked.record.protected = true; },
    report => { report.selected[0].checked = null; },
    report => { report.selected[30].status = "consistent"; },
    report => { report.liveWrites = 100; },
    report => { report.observed.control.paused = true; },
  ]) { const report = copy(original); change(report); assert.throws(() => validatePilotReport(report)); }
});
test("snapshot schema rejects private fields, duplicate identities, provider patches and nonpublic references", () => {
  for (const change of [
    snapshot => { snapshot.accessToken = "synthetic-secret"; },
    snapshot => { snapshot.records[0].userEmail = "private@example.test"; },
    snapshot => { snapshot.records.push(copy(snapshot.records[0])); },
    snapshot => { snapshot.records[0].proposal.patch.identity = "replacement"; },
    snapshot => { snapshot.records[0].valueHash = ["a".repeat(64)]; },
    snapshot => { snapshot.records[0].proposal.evidence[0].url = "https://127.0.0.1/private"; },
    snapshot => { snapshot.records[42].proposal.patch.facts = [{ field: "address", value: "Replacement", source: "https://example.invalid/source" }]; },
    snapshot => { snapshot.totals.artist = 3; },
  ]) { const snapshot = syntheticPilotSnapshot(at); change(snapshot); assert.throws(() => validatePilotSnapshot(snapshot)); }
  assert.throws(() => parsePilotFile("{"), /valid JSON/);
  assert.equal(pilotBytes("é😀"), Buffer.byteLength("é😀"));
  assert.throws(() => parsePilotFile("é".repeat(PILOT_MAX_BYTES / 2 + 1)), /too large/);
});
test("comparison preserves current findings, supplied provenance and image/event delivery caveats", () => {
  const report = start(), event = report.selected.find(row => row.type === "event"), before = JSON.stringify(event);
  const view = pilotRowView(event);
  assert.equal(view.current.summary, ""); assert.match(view.proposed.summary, /synthetic catalog record/);
  assert.match(view.attribution, /human approval not recorded/); assert.match(view.imageState, /no photos attached/);
  assert.match(view.eventState, /public rendering/); assert.equal(JSON.stringify(event), before);
});
test("snapshot consistency is explicitly distinct from live proposal validation", () => {
  const snapshot = syntheticPilotSnapshot(at);
  snapshot.records[0].proposal.patch = { summary: "x", summarySources: [] };
  const report = advance(createPilotReport(snapshot));
  assert.equal(report.selected[0].status, "consistent");
  const summary = pilotSummary(report);
  assert.equal(summary.liveProposalValidation, "not_performed");
  assert.equal(summary.consistentMeaning, "snapshot_bindings_consistent");
  assert.equal(summary.humanApproval, "not_recorded");
});
