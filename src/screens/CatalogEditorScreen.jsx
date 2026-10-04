import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useStore } from "../store";
import { catalogEditorForAccount } from "../features/catalogEditor/catalogEditorService";
const randomId = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
import SheetHeader from "../components/SheetHeader";
import Button from "../components/Button";
import { colors, radius, space } from "../theme";
import { addCatalogBatchDraft, catalogDraftFromText } from "../features/catalogEditor/catalogEditorApi.mjs";

// Keyed by account and role at the navigation boundary. No moderation store loads.
export default function CatalogEditorScreen({ onClose }) {
  const { session } = useStore();
  const allowed = session?.role === "admin";
  const service = useMemo(() => allowed ? catalogEditorForAccount(session.id) : null, [allowed, session?.id]);
  const [type, setType] = useState("artist"), [query, setQuery] = useState(""), [missingOnly, setMissingOnly] = useState(true);
  const [page, setPage] = useState(null), [entity, setEntity] = useState(null), [summary, setSummary] = useState("");
  const [sourceLines, setSourceLines] = useState(""), [reason, setReason] = useState("");
  const [batch, setBatch] = useState([]), [prepared, setPrepared] = useState(null), [receipts, setReceipts] = useState({});
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [dirty, setDirty] = useState(false), [pendingSelection, setPendingSelection] = useState(null), [confirmClose, setConfirmClose] = useState(false);
  const request = useRef(null), mounted = useRef(true), receiptKeys = useRef(new Map());
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, []);
  const run = async work => {
    if (!service || request.current) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(""); setNotice("");
    try { await work(controller.signal); }
    catch (failure) { if (!controller.signal.aborted && mounted.current) setError(failure.message || "Catalog action failed. Your draft is still here."); }
    finally { if (request.current === controller) request.current = null; if (mounted.current) setBusy(false); }
  };
  const load = cursor => run(async signal => {
    const value = await service.list({ type, query, missingOnly, cursor, signal });
    if (!signal.aborted) setPage(value);
  });
  const select = (row, discard = false) => {
    if (dirty && !discard) { setPendingSelection(row); return; }
    setPendingSelection(null);
    return run(async signal => {
    const current = await service.read({ type: row.type, key: row.key, signal });
    if (signal.aborted) return;
    setEntity(current); setSummary(current.content?.summary || "");
    setSourceLines((current.content?.sources || []).map(source => `${source.label} | ${source.url}`).join("\n"));
    setReason(""); setDirty(false);
    });
  };
  const stage = hidden => {
    try {
      const draft = catalogDraftFromText(entity, { summary, sourceLines, reason, hidden });
      setBatch(addCatalogBatchDraft(batch, draft)); setPrepared(null); setReceipts({});
      setDirty(false);
      setNotice("Draft added to this batch. Review the batch before publishing."); setError("");
    } catch (failure) { setError(failure.message); }
  };
  const prepare = () => run(async signal => {
    const result = await service.prepare(batch, signal);
    if (!signal.aborted) { setPrepared(result.results); setReceipts({}); }
  });
  const publish = row => run(async signal => {
    let key = receiptKeys.current.get(row.payloadHash);
    if (!key) { key = `catalog_${randomId()}`; receiptKeys.current.set(row.payloadHash, key); }
    const result = await service.save(row.draft, key, signal);
    if (signal.aborted) return;
    setReceipts(previous => ({ ...previous, [row.index]: result }));
    setNotice(`Saved ${result.saved.identity.name}, revision ${result.revision}. Provider facts were preserved.`);
    setBatch(previous => previous.filter(entry => entry.type !== row.draft.type || entry.key !== row.draft.key));
    // Confirmed result is the committed server reread, not an optimistic local patch.
    if (entity?.type === result.saved.type && entity?.key === result.saved.key) setEntity(result.saved);
  });
  return <View style={styles.root}>
    <SheetHeader title="Catalog editor" onClose={() => dirty || batch.length ? setConfirmClose(true) : onClose()} />
    {!allowed ? <Text style={styles.error}>An administrator account is required.</Text> : <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Fill missing page text</Text>
      <Text style={styles.copy}>Write sourced context for public artists, venues and events. Dates, tickets, identities, biographies and other provider facts stay intact.</Text>
      {session.emailVerified !== true ? <Text style={styles.error}>Confirm your account email before preparing or saving changes.</Text> : null}
      <View style={styles.row}>{["artist", "venue", "event"].map(value => <Button key={value} small title={`${value[0].toUpperCase()}${value.slice(1)}s`} disabled={busy} variant={type === value ? "primary" : "secondary"}
        onPress={() => { setType(value); setPage(null); }} />)}</View>
      <TextInput accessibilityLabel="Find catalog pages by name" placeholder="Artist, venue or event name" placeholderTextColor={colors.textFaint} value={query} onChangeText={setQuery} editable={!busy} style={styles.input} maxLength={100} />
      <View style={styles.row}><Button title="Find pages" onPress={() => load("")} disabled={busy} loading={busy} /><Button title={missingOnly ? "Showing missing text" : "Showing all eligible pages"} variant="secondary" disabled={busy} onPress={() => { setMissingOnly(!missingOnly); setPage(null); }} /></View>
      {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}
      {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
      {pendingSelection ? <View style={styles.panel}><Text style={styles.copy}>This page has an unstaged draft. Add it to the batch to keep it, or discard it before opening another page.</Text><View style={styles.row}><Button title="Keep editing" onPress={() => setPendingSelection(null)} /><Button title="Discard and open page" variant="secondary" onPress={() => select(pendingSelection, true)} /></View></View> : null}
      {confirmClose ? <View style={styles.panel}><Text style={styles.copy}>Unpublished drafts will be discarded when this editor closes.</Text><View style={styles.row}><Button title="Keep editor open" onPress={() => setConfirmClose(false)} /><Button title="Discard drafts and close" variant="secondary" onPress={onClose} /></View></View> : null}
      {page ? <View style={styles.panel}><Text style={styles.heading}>Page queue</Text>
        {!page.items.length ? <Text style={styles.copy}>{page.nextCursor ? "No matching gaps in this slice. Continue to the next page." : "No matching eligible pages in this slice."}</Text> : null}
        {page.items.map(row => <View key={`${row.type}:${row.key}`} style={styles.queueItem}><View style={styles.grow}><Text style={styles.heading}>{row.identity.name}</Text><Text style={styles.copy}>{[row.identity.city, row.identity.country, row.identity.date].filter(Boolean).join(" · ")}</Text><Text style={styles.small}>{row.missingFields.join(", ") || "Existing content retained"}</Text></View><Button small title="Edit text" disabled={busy} onPress={() => select(row)} /></View>)}
        {page.nextCursor ? <Button title="Next page" variant="secondary" disabled={busy} onPress={() => load(page.nextCursor)} /> : null}
      </View> : null}
      {entity ? <View style={styles.panel}><Text style={styles.heading}>{entity.identity.name}</Text><Text selectable style={styles.small}>{entity.type} · {entity.key} · revision {entity.revision}</Text>
        {!entity.identityCurrent ? <Text style={styles.error}>The catalog identity changed. Existing staff text is hidden; review its sources before publishing again.</Text> : null}
        {entity.protectedReason ? <Text style={styles.error}>{entity.protectedReason}</Text> : null}
        <Text style={styles.copy}>Existing facts (read-only)</Text><Text selectable style={styles.facts}>{Object.entries(entity.protectedFacts).filter(([, value]) => value != null && value !== "").map(([key, value]) => `${key}: ${value}`).join("\n") || "No provider text recorded."}</Text>
        <Text style={styles.label}>Sourced page text</Text><TextInput accessibilityLabel="Sourced page text" value={summary} onChangeText={value => { setSummary(value); setDirty(true); }} multiline maxLength={2400} editable={!busy} style={[styles.input, styles.multiline]} />
        <Text style={styles.label}>Sources — one “Name | https://page” per line</Text><TextInput accessibilityLabel="Named source URLs" value={sourceLines} onChangeText={value => { setSourceLines(value); setDirty(true); }} multiline maxLength={14000} autoCapitalize="none" editable={!busy} style={[styles.input, styles.multiline]} />
        <Text style={styles.label}>Reason for change</Text><TextInput accessibilityLabel="Reason for catalog change" value={reason} onChangeText={value => { setReason(value); setDirty(true); }} maxLength={300} editable={!busy} style={styles.input} />
        <View style={styles.row}><Button title="Add to batch" disabled={busy || !!entity.protectedReason || session.emailVerified !== true} onPress={() => stage(false)} />{entity.content && !entity.content.hidden ? <Button title="Prepare hiding this text" variant="secondary" disabled={busy} onPress={() => stage(true)} /> : null}</View>
      </View> : null}
      <View style={styles.panel}><Text style={styles.heading}>Draft batch · {batch.length}</Text><Text style={styles.copy}>Drafts stay in this screen until saved. Verify every source and identity. No provider or AI request runs here.</Text>
        {batch.map(entry => <Text key={`${entry.type}:${entry.key}`} style={styles.copy}>{entry.type}: {entry.key}</Text>)}
        <View style={styles.row}><Button title="Review prepared batch" disabled={busy || !batch.length || session.emailVerified !== true} onPress={prepare} /><Button title="Clear batch" variant="secondary" disabled={busy || !batch.length} onPress={() => { setBatch([]); setPrepared(null); setReceipts({}); }} /></View>
        {prepared?.map(row => <View key={row.index} style={styles.review}>
          {!row.ok ? <Text style={styles.error}>Entry {row.index + 1}: {row.error}</Text> : <>
            <Text style={styles.heading}>{row.current.identity.name}</Text><Text style={styles.copy}>Before: {row.current.content?.summary || "No staff text"}</Text><Text selectable style={styles.copy}>After: {row.draft.hidden ? "Hidden from public pages" : row.draft.summary}</Text>
            {row.draft.sources.map(source => <Text selectable key={source.url} style={styles.small}>{source.label}: {source.url}</Text>)}
            {receipts[row.index] ? <Text style={styles.notice}>Saved revision {receipts[row.index].revision} · receipt {receipts[row.index].auditId}</Text> : <Button title={row.draft.hidden ? "Confirm hide" : "Confirm sources and publish"} disabled={busy} onPress={() => publish(row)} />}
          </>}
        </View>)}
      </View>
    </ScrollView>}
  </View>;
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.bg }, content: { padding: space(4), gap: space(3), width: "100%", maxWidth: 1050, alignSelf: "center" },
  title: { color: colors.text, fontSize: 26, fontWeight: "800" }, heading: { color: colors.text, fontSize: 16, fontWeight: "700" },
  copy: { color: colors.textDim, fontSize: 14, lineHeight: 21 }, small: { color: colors.textDim, fontSize: 12, lineHeight: 18 }, label: { color: colors.text, fontSize: 13, fontWeight: "700" },
  panel: { backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1, borderRadius: radius.md, padding: space(4), gap: space(3) },
  row: { flexDirection: "row", flexWrap: "wrap", gap: space(2) }, input: { color: colors.text, borderColor: colors.line, borderWidth: 1, borderRadius: radius.sm, padding: space(3), fontSize: 14 },
  multiline: { minHeight: 110, textAlignVertical: "top" }, error: { color: colors.danger, fontSize: 13 }, notice: { color: colors.good, fontSize: 13 },
  queueItem: { flexDirection: "row", gap: space(3), alignItems: "center", paddingVertical: space(2) }, grow: { flex: 1 }, facts: { color: colors.textDim, fontSize: 12, lineHeight: 19 },
  review: { borderTopColor: colors.line, borderTopWidth: 1, paddingTop: space(3), gap: space(2) } });
