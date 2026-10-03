import { useMemo, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import Button from "../../components/Button";
import { colors, space } from "../../theme";
import { createCatalogLivePilotApi } from "./catalogLivePilotApi.mjs";

export default function CatalogLivePilotPanel({ accountId }) {
  const service = useMemo(() => createCatalogLivePilotApi({ accountId }), [accountId]);
  const [rows, setRows] = useState([]), [selected, setSelected] = useState([]), [pairing, setPairing] = useState(null);
  const [proposalId, setProposalId] = useState(""), [proposal, setProposal] = useState(null), [page, setPage] = useState(null);
  const [grantId, setGrantId] = useState(""), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [browse, setBrowse] = useState(null);
  const load = async (type, cursor) => { const result = await service.inventory(type, cursor); setRows(result.items); setBrowse({ type, cursor: result.nextCursor }); };
  const run = async work => { if (busy) return; setBusy(true); setMessage(""); try { await work(); } catch (error) { setMessage(error.message); } finally { setBusy(false); } };
  const choose = row => setSelected(current => current.some(item => item.type === row.type && item.key === row.key)
    ? current.filter(item => item.type !== row.type || item.key !== row.key)
    : current.length < 6 ? [...current, row] : current);
  const issue = async () => {
    const types = [...new Set(selected.map(row => row.type))];
    const result = await service.pair({ actorLabel: "Supervised catalog pilot", entities: selected.map(({ type, key }) => ({ type, key })),
      scopes: types.flatMap(type => ["read", "propose", "commit"].map(action => `catalog:${type}:${action}`)), commitLimit: selected.filter(row => row.eligible).length });
    setPairing(result); setMessage("Pairing is ready. It expires in five minutes; connected access lasts thirty minutes.");
  };
  return <View style={styles.panel}>
    <Text accessibilityRole="header" style={styles.title}>Supervised catalog pilot</Text>
    <Text style={styles.copy}>Select up to six records for this trial. Review each proposed change before its first publication.</Text>
    <View style={styles.row}>{["artist", "venue", "event"].map(type => <Button key={type} small title={`Browse ${type} records`} disabled={busy}
      onPress={() => run(() => load(type))} />)}</View>
    {rows.map(row => <View key={`${row.type}:${row.key}`} style={styles.row}>
      <Text selectable style={styles.copy}>{row.identity.name}{row.eligible ? "" : " · Preserve existing content"}</Text>
      <Button small variant="secondary" title={selected.some(item => item.type === row.type && item.key === row.key) ? `Remove ${row.identity.name}` : `Select ${row.identity.name}`} onPress={() => choose(row)} />
      <Button small variant="secondary" title={`Inspect ${row.identity.name}`} onPress={() => run(async () => setPage(await service.read(row.type, row.key)))} />
    </View>)}
    {browse?.cursor ? <Button small title="Next catalog records" disabled={busy} onPress={() => run(() => load(browse.type, browse.cursor))} /> : null}
    {selected.map(row => <Text selectable key={`${row.type}:${row.key}`} style={styles.copy}>Selected {row.type}: {row.identity.name} ({row.key})</Text>)}
    <Text style={styles.copy}>{selected.length} selected; at most {selected.filter(row => row.eligible).length} commits.</Text>
    <Button title="Create temporary pilot pairing" disabled={busy || !selected.length || !selected.some(row => row.eligible)} onPress={() => run(issue)} />
    {pairing ? <View><Text style={styles.copy}>Private pairing code — share only with the supervised client.</Text>
      <Text selectable style={styles.copy}>{pairing.pairingCode}</Text><Button small title="Dismiss pairing code" onPress={() => setPairing(null)} /></View> : null}
    <TextInput accessibilityLabel="Catalog proposal ID" value={proposalId} onChangeText={setProposalId} placeholder="Proposal ID" style={styles.input} />
    <Button title="Load proposed change" disabled={busy || !proposalId} onPress={() => run(async () => setProposal(await service.detail(proposalId)))} />
    {proposal ? <View style={styles.panel}>
      <Text style={styles.title}>{proposal.current.identity.name}</Text>
      <Text selectable style={styles.copy}>Current: {proposal.current.findings?.summary || "No researched summary"}</Text>
      <Text selectable style={styles.copy}>Proposed: {proposal.patch.summary || proposal.current.findings?.summary}</Text>
      {(proposal.patch.facts || []).map(fact => <Text selectable key={fact.field} style={styles.copy}>{fact.field}: {fact.value} — {fact.source}</Text>)}
      {proposal.evidence.map(source => <Text selectable key={source.url} style={styles.copy}>{source.title}: {source.url}</Text>)}
      {proposal.proposedAttachments.map(photo => <Text selectable key={photo.assetHash} style={styles.copy}>{photo.label} · {photo.creator} · {photo.license} · {photo.sourcePage} · {photo.modificationNotice}</Text>)}
      <Text style={styles.copy}>Submitted evidence needs source review. Approval covers this exact proposal.</Text>
      <View style={styles.row}><Button title="Approve this proposal" disabled={busy || proposal.status !== "pending"} onPress={() => run(async () => { await service.review(proposal, true); setProposal(await service.detail(proposal.id)); })} />
        <Button title="Reject this proposal" variant="secondary" disabled={busy || proposal.status !== "pending"} onPress={() => run(async () => { await service.review(proposal, false); setProposal(await service.detail(proposal.id)); })} /></View>
      <Text style={styles.copy}>Status: {proposal.status}</Text>
    </View> : null}
    {page ? <View style={styles.panel}>
      <Text style={styles.title}>{page.identity.name}</Text><Text selectable style={styles.copy}>{page.findings?.summary || "No visible research"}</Text>
      <Button title="Refresh selected record" disabled={busy} onPress={() => run(async () => setPage(await service.read(page.type, page.key)))} />
      <Button title="Hide researched content" disabled={busy || page.hidden || !page.findings} onPress={() => run(async () => { await service.correct(page, "hide"); setPage(await service.read(page.type, page.key)); })} />
      {page.changes.filter(change => !change.restoredAt).slice(0, 1).map(change => <Button key={change.id} title="Restore content before latest pilot change" disabled={busy}
        onPress={() => run(async () => { await service.correct(page, "restore", change.id); setPage(await service.read(page.type, page.key)); })} />)}
    </View> : null}
    <TextInput accessibilityLabel="Catalog grant ID" value={grantId} onChangeText={setGrantId} placeholder="Grant ID to revoke" style={styles.input} />
    <Button title="Revoke pilot access" disabled={busy || !grantId} onPress={() => run(async () => { await service.revoke(grantId); setMessage("Pilot access revoked."); })} />
    {message ? <Text accessibilityLiveRegion="polite" style={styles.copy}>{message}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({ panel: { gap: space(2), paddingVertical: space(3) }, row: { flexDirection: "row", flexWrap: "wrap", gap: space(2), alignItems: "center" },
  title: { color: colors.text, fontSize: 17, fontWeight: "700" }, copy: { color: colors.textDim, fontSize: 13, flexShrink: 1 },
  input: { color: colors.text, padding: space(2), borderWidth: 1, borderColor: colors.line, borderRadius: 6 } });
