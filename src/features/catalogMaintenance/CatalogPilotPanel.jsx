import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import Button from "../../components/Button";
import { colors, mono, radius } from "../../theme";
import { PILOT_MAX_BYTES, PILOT_TYPES, advancePilotReport, createPilotReport, parsePilotFile, pausePilotReport,
  pilotRowView, pilotSummary, serializePilotReport, syntheticPilotSnapshot } from "./catalogPilot.mjs";

const labels = { pending: "Pending", consistent: "Snapshot bindings consistent", awaiting_proposal: "Needs current proposal evidence",
  conflict: "Conflict", quarantined: "Protected or quarantined", paused: "Snapshot paused", revoked: "Snapshot grant revoked or expired" };
const time = value => new Date(value).toLocaleString();
function Findings({ title, value }) {
  return <View style={styles.findings}>
    <Text style={styles.label}>{title}</Text>
    <Text selectable style={styles.copy}>{value?.summary || "No summary supplied."}</Text>
    {(value?.facts || []).map((fact, index) => <Text selectable style={styles.copy} key={`${fact.field}-${index}`}>
      {fact.field.replaceAll("_", " ")}: {fact.value}{"\n"}{fact.source}
    </Text>)}
    {(value?.summarySources || []).map(source => <Text selectable key={source} style={styles.hint}>{source}</Text>)}
    {(value?.images || []).map(source => <Text selectable key={source} style={styles.hint}>Image candidate: {source}</Text>)}
  </View>;
}
function PilotRecord({ entry }) {
  const [open, setOpen] = useState(false), view = pilotRowView(entry);
  return <View style={styles.record}>
    <Text selectable style={styles.label}>{view.type.toUpperCase()} · {labels[view.status]}</Text>
    <Text selectable style={styles.name}>{view.name}</Text>
    <Text selectable style={styles.key}>{view.key}</Text>
    <Button small variant="secondary" title={open ? "Hide comparison" : "Compare proposal"}
      accessibilityLabel={`${open ? "Hide" : "Compare"} proposal for ${view.name}`} onPress={() => setOpen(!open)} />
    {open ? <>
      <Text selectable style={styles.hint}>Revision {entry.base.revision}. Identity binding: {entry.base.identityHash}</Text>
      <Text selectable style={styles.hint}>Snapshot work: {entry.checked?.record?.work.status || entry.base.work.status}.</Text>
      <View style={styles.columns}><Findings title="Current findings" value={view.current} />
        <Findings title="Proposed findings" value={view.proposed} /></View>
      <Text selectable style={styles.copy}>{view.actorLabel}. {view.attribution}.</Text>
      <Text style={styles.label}>Submitted evidence</Text>
      {view.evidence.length ? view.evidence.map((source, index) => <Text selectable style={styles.hint} key={index}>
        {source.title}{"\n"}{source.url}{"\n"}Access reported: {time(source.accessedAt)}. Evidence hash: {source.evidenceHash}
      </Text>) : <Text style={styles.hint}>No evidence supplied.</Text>}
      <Text style={styles.hint}>Source content has not been fetched or independently verified by this preview.</Text>
      <Text style={styles.hint}>{view.imageState}. {view.eventState || ""}</Text>
    </> : null}
  </View>;
}
export default function CatalogPilotPanel() {
  const [report, setReport] = useState(null), [input, setInput] = useState(""), [limit, setLimit] = useState("100");
  const [page, setPage] = useState(0), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const summary = report ? pilotSummary(report) : null;
  const update = (work) => {
    setError(""); setNotice("");
    try { const next = work(); serializePilotReport(next); setReport(next); }
    catch (failure) { setError(failure.message); }
  };
  const load = () => update(() => {
    const value = parsePilotFile(input);
    const next = value.kind === "catalog-pilot-dry-run" ? value : createPilotReport(value, Number(limit));
    setPage(0); setInput(""); return next;
  });
  const copyCheckpoint = async () => {
    setError(""); setNotice("");
    try {
      const copied = await Clipboard.setStringAsync(serializePilotReport(report));
      if (!copied) throw new Error("Clipboard unavailable.");
      setNotice("Checkpoint copied. Save it as a local JSON file to resume this exact selection.");
    } catch { setError("The checkpoint could not be copied. Keep this preview open and try again."); }
  };
  return <View style={styles.panel} testID="catalog-pilot-panel">
    <Text accessibilityRole="header" style={styles.title}>Catalog pilot review</Text>
    <Text style={styles.copy}>Review up to 100 existing eligible records across artists, venues and events. This preview reads a supplied snapshot and makes no live claims, catalog writes or provider calls.</Text>
    <Text style={styles.hint}>The initial pilot is for owner inspection. Checks compare supplied identities, revisions, protection, work state and citations. Live proposal validation and human approval are not performed here. Any future automatic publishing policy needs separate owner approval and activation.</Text>
    <View style={styles.actions}>
      <TextInput accessibilityLabel="Pilot selection limit" value={limit} onChangeText={setLimit} keyboardType="number-pad"
        maxLength={3} style={styles.limit} />
      <Button small title="Use synthetic fixture" variant="secondary" onPress={() => update(() => {
        setPage(0); return createPilotReport(syntheticPilotSnapshot(), Number(limit));
      })} />
    </View>
    <Text style={styles.hint}>Paste a catalog-only snapshot you are authorized to use, or a saved checkpoint. Include no credentials or private user records. Loading a new preview replaces the one shown.</Text>
    <TextInput accessibilityLabel="Authorized catalog snapshot or checkpoint" multiline value={input} onChangeText={setInput}
      maxLength={PILOT_MAX_BYTES} autoCapitalize="none" autoCorrect={false} placeholder="Paste local JSON" placeholderTextColor={colors.textDim} style={styles.input} />
    <View style={styles.actions}>
      <Button small title="Load local preview" variant="secondary" disabled={!input.trim()} onPress={load} />
      <Button small title="Recheck with newer snapshot" variant="secondary" disabled={!report || !input.trim()} onPress={() => update(() => {
        const next = advancePilotReport(report, { snapshot: parsePilotFile(input), batchSize: 0, expectedRevision: report.revision });
        setInput(""); return next;
      })} />
    </View>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.copy}>{notice}</Text> : null}
    {report ? <>
      <Text selectable style={styles.label}>{summary.confidence}</Text>
      <Text selectable style={styles.copy}>{summary.selected} selected · {summary.examined} checked locally · {summary.pending} pending · 0 live writes</Text>
      <Text selectable style={styles.hint}>Observed {time(summary.observedAt)}; checked locally {time(summary.evaluatedAt)}. Snapshot grant: {summary.control.grantStatus.replaceAll("_", " ")}. Snapshot work: {summary.control.paused ? "paused" : "not paused"}. Preview: {summary.previewPaused ? "paused" : "open"}.</Text>
      {PILOT_TYPES.map(type => <Text selectable style={styles.hint} key={type}>
        {type}: {summary.byType[type]} selected; {summary.inventory[type].observed} records supplied, {summary.inventory[type].eligible} eligible in that snapshot. Reported total: {summary.inventory[type].reportedTotal ?? "unknown"}.
      </Text>)}
      <Text selectable style={styles.hint}>{Object.entries(labels).filter(([status]) => status !== "pending")
        .map(([status, label]) => `${label}: ${summary[status]}`).join(" · ")}</Text>
      <View style={styles.actions}>
        <Button small title={summary.pending ? "Check next 25 locally" : "Recheck snapshot locally"} disabled={report.paused}
          onPress={() => update(() => advancePilotReport(report, { expectedRevision: report.revision }))} />
        <Button small title={report.paused ? "Resume preview" : "Pause preview"} variant="secondary"
          onPress={() => update(() => pausePilotReport(report, !report.paused, report.revision))} />
        <Button small title="Copy checkpoint" variant="secondary" onPress={copyCheckpoint} />
        <Button small title="Clear preview" variant="secondary" onPress={() => { setReport(null); setInput(""); setNotice(""); setError(""); }} />
      </View>
      <Text style={styles.hint}>A checked row is not a completed catalog page. Copy a checkpoint before leaving this section; account changes or loss of owner access clear the preview.</Text>
      {report.selected.slice(page * 10, page * 10 + 10).map(entry => <PilotRecord key={`${report.snapshot.sourceId}:${entry.type}:${entry.key}`} entry={entry} />)}
      <View style={styles.actions}>
        <Button small title="Previous pilot records" variant="secondary" disabled={!page} onPress={() => setPage(page - 1)} />
        <Text style={styles.hint}>Page {page + 1} of {Math.max(1, Math.ceil(summary.selected / 10))}</Text>
        <Button small title="Next pilot records" variant="secondary" disabled={(page + 1) * 10 >= summary.selected} onPress={() => setPage(page + 1)} />
      </View>
    </> : null}
  </View>;
}
const styles = StyleSheet.create({
  panel: { borderTopWidth: 1, borderTopColor: colors.lineSoft, paddingTop: 16, gap: 12 },
  title: { color: colors.text, fontSize: 18, fontWeight: "800" },
  name: { color: colors.text, fontSize: 15, fontWeight: "700" },
  label: { color: colors.amber, fontSize: 12, fontWeight: "700" },
  copy: { color: colors.textDim, fontSize: 13, lineHeight: 20 },
  hint: { color: colors.textDim, fontSize: 12, lineHeight: 18, flexShrink: 1 },
  key: { color: colors.textDim, fontFamily: mono, fontSize: 11, flexShrink: 1 },
  error: { color: colors.danger, fontSize: 13, lineHeight: 20 },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  input: { color: colors.text, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.sm, padding: 10, minHeight: 80, maxHeight: 150, textAlignVertical: "top", fontFamily: mono, fontSize: 11 },
  limit: { color: colors.text, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, padding: 10, width: 70 },
  record: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, padding: 12, gap: 9 },
  columns: { flexDirection: "row", flexWrap: "wrap", gap: 16 },
  findings: { flexBasis: 260, flexGrow: 1, minWidth: 0, gap: 8 },
});
