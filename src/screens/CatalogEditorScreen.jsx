import { useEffect, useMemo, useRef, useState } from "react";
import { Image, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useStore } from "../store";
import { catalogEditorForAccount } from "../features/catalogEditor/catalogEditorService";
import { createCatalogBatch } from "../features/catalogEditor/catalogBatchState.mjs";
import { catalogBatchStorage } from "../features/catalogEditor/catalogBatchStorage";
import SheetHeader from "../components/SheetHeader";
import Button from "../components/Button";
import { colors, radius, space } from "../theme";
import { catalogDraftFromText, catalogExactSelection } from "../features/catalogEditor/catalogEditorApi.mjs";

// Keyed by account and role at the navigation boundary. No moderation store loads.
export default function CatalogEditorScreen({ onClose }) {
  const { session } = useStore();
  const allowed = session?.role === "admin";
  const service = useMemo(() => allowed ? catalogEditorForAccount(session.id) : null, [allowed, session?.id]);
  const owner = useRef(null), account = useRef(session?.id);
  account.current = allowed ? session?.id : null;
  if (!owner.current) {
    try { owner.current = { controller: allowed ? createCatalogBatch({ accountId: session.id, storage: catalogBatchStorage }) : null }; }
    catch (failure) { owner.current = { error: failure.message }; }
  }
  const durable = owner.current.controller;
  const [savedBatch, setSavedBatch] = useState(() => durable?.get() || { entries: [], receipts: [] });
  const batch = savedBatch.entries.map(entry => entry.draft);
  const prepared = savedBatch.entries.map(entry => entry.review).filter(Boolean);
  const [completionMode, setCompletionMode] = useState(false), [photoLoaded, setPhotoLoaded] = useState("");
  const [type, setType] = useState("artist"), [query, setQuery] = useState(""), [missingOnly, setMissingOnly] = useState(true);
  const [exactKey, setExactKey] = useState("");
  const [page, setPage] = useState(null), [entity, setEntity] = useState(null), [summary, setSummary] = useState("");
  const [sourceLines, setSourceLines] = useState(""), [reason, setReason] = useState("");
  const [hiddenDraft, setHiddenDraft] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(owner.current.error || ""), [notice, setNotice] = useState("");
  const [dirty, setDirty] = useState(false), [pendingSelection, setPendingSelection] = useState(null), [confirmClose, setConfirmClose] = useState(false);
  const request = useRef(null), mounted = useRef(true);
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
    const value = await (completionMode ? service.plan : service.list)({ type, query, missingOnly, cursor, signal });
    if (!signal.aborted) setPage(value);
  });
  const select = (row, discard = false) => {
    if (dirty && !discard) { setPendingSelection(row); return; }
    setPendingSelection(null);
    return run(async signal => {
    let current;
    try { current = await (row.completion || completionMode ? service.completion : service.read)({ type: row.type, key: row.key, signal }); }
    catch (failure) {
      if (failure.status === 404) throw new Error(`No eligible ${row.type} matches this exact key. Check the page type, source and letter case.`);
      throw failure;
    }
    if (signal.aborted || !mounted.current) return;
    if (current?.type !== row.type || current?.key !== row.key) throw new Error("The returned catalog identity did not match. Your current draft was kept; try opening the exact key again.");
    setEntity(current); setSummary(current.content?.summary || current.completion?.suggested?.summary || "");
    setSourceLines((current.content?.sources || current.completion?.suggested?.sources || []).map(source => `${source.label} | ${source.url}`).join("\n"));
    setReason(""); setHiddenDraft(false); setDirty(false);
    });
  };
  const openExact = () => {
    if (busy || request.current || !service) return;
    try { return select(catalogExactSelection(type, exactKey)); }
    catch (failure) { setError(failure.message); setNotice(""); }
  };
  const stage = hidden => {
    try {
      const draft = catalogDraftFromText(entity, { summary, sourceLines, reason, hidden });
      if (!durable) throw new Error("Durable batch storage is unavailable. Reopen the editor after restoring storage.");
      setSavedBatch(durable.stage(draft));
      setHiddenDraft(hidden);
      setDirty(false);
      setNotice("Draft saved on this device for this account. Review the batch before publishing."); setError("");
    } catch (failure) { setError(failure.message); }
  };
  const prepare = () => run(async signal => {
    const result = await service.prepare(batch, signal);
    if (!signal.aborted) setSavedBatch(durable.review(result.results));
  });
  const publish = id => run(async signal => {
    if (dirty) throw new Error("Add the open edit to the batch before publishing, so no unstaged work is lost.");
    await durable.publish({ service, signal, id, current: () => mounted.current && account.current === session.id, onChange: setSavedBatch,
      onReceipt: result => setEntity(previous => previous?.type === result.saved.type && previous?.key === result.saved.key ? null : previous) });
    setNotice("Saved receipts were recorded and public text was checked. Review the photo on the public page before calling it complete.");
  });
  const remove = id => { try { setSavedBatch(durable.remove(id)); setError(""); } catch (failure) { setError(failure.message); } };
  const edit = entry => {
    if (dirty) { setError("Add the open draft to the batch before editing another saved entry."); return; }
    return run(async signal => {
      const current = await (entry.draft.completionHash ? service.completion : service.read)({ ...entry.draft, signal });
      if (signal.aborted) return;
      if (current.type !== entry.draft.type || current.key !== entry.draft.key) throw new Error("The returned catalog identity did not match.");
      setEntity(current); setSummary(entry.draft.summary);
      setSourceLines(entry.draft.sources.map(source => `${source.label} | ${source.url}`).join("\n"));
      setReason(entry.draft.reason); setHiddenDraft(entry.draft.hidden === true); setDirty(true);
      setNotice("Saved draft restored against the current page. Review any changed facts, then add it to the batch again.");
    });
  };
  return <View style={styles.root}>
    <SheetHeader title="Catalog editor" onClose={() => dirty ? setConfirmClose(true) : onClose()} />
    {!allowed ? <Text style={styles.error}>An administrator account is required.</Text> : <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Fill missing page text</Text>
      <Text style={styles.copy}>Write sourced context for public artists, venues and events. Dates, tickets, identities, biographies and other provider facts stay intact.</Text>
      {session.emailVerified !== true ? <Text style={styles.error}>Confirm your account email before preparing or saving changes.</Text> : null}
      <View style={styles.row}>{["artist", "venue", "event"].map(value => <Button key={value} small title={`${value[0].toUpperCase()}${value.slice(1)}s`} disabled={busy} variant={type === value ? "primary" : "secondary"}
        onPress={() => { setType(value); setPage(null); if (value === "event") setCompletionMode(false); }} />)}</View>
      {type !== "event" ? <Button title={completionMode ? "Completion plan selected" : "Plan text and photo completion"} variant="secondary" disabled={busy} onPress={() => { setCompletionMode(!completionMode); setPage(null); }} /> : null}
      {completionMode ? <Text style={styles.copy}>Review up to ten artists or venues per page, in catalog key order. Ten is the batch size, not an hourly cap. This reads stored sources and accepted photos; it does not run providers or image jobs.</Text> : null}
      <TextInput accessibilityLabel="Find catalog pages by name" placeholder="Artist, venue or event name" placeholderTextColor={colors.textFaint} value={query} onChangeText={value => { setQuery(value); setPage(null); }} editable={!busy} style={styles.input} maxLength={100} />
      {type === "venue" ? <Text style={styles.copy}>Venue name search checks part of the catalog at a time. Continue searching when more pages are available, or open a known catalog key below.</Text> : null}
      <View style={styles.row}><Button title="Find pages" onPress={() => load("")} disabled={busy} loading={busy} /><Button title={missingOnly ? "Showing missing text" : "Showing all eligible pages"} variant="secondary" disabled={busy} onPress={() => { setMissingOnly(!missingOnly); setPage(null); }} /></View>
      {missingOnly ? <Text style={styles.copy}>The fill queue skips existing biographies, researched and saved text, and pages needing identity or staff review. Use all eligible pages or an exact key to review an existing record.</Text> : null}
      <View style={styles.panel}>
        <Text style={styles.heading}>Open by catalog key</Text>
        <Text style={styles.copy}>Choose the page type above and enter its exact key. For venues, use source:provider ID with the original letter case. This opens one eligible page, including pages that already have text.</Text>
        <TextInput accessibilityLabel="Exact catalog key" placeholder={type === "venue" ? "source:provider ID" : "Exact catalog key"} placeholderTextColor={colors.textFaint} value={exactKey} onChangeText={setExactKey} autoCapitalize="none" autoCorrect={false} editable={!busy} maxLength={450} style={styles.input} />
        <Button title="Open by catalog key" disabled={busy} onPress={openExact} />
      </View>
      {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}
      {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
      {pendingSelection ? <View style={styles.panel}><Text style={styles.copy}>This page has an unstaged draft. Add it to the batch to keep it, or discard it before opening another page.</Text><View style={styles.row}><Button title="Keep editing" onPress={() => setPendingSelection(null)} /><Button title="Discard and open page" variant="secondary" onPress={() => select(pendingSelection, true)} /></View></View> : null}
      {confirmClose ? <View style={styles.panel}><Text style={styles.copy}>The unstaged edit will be discarded. Saved batch entries remain on this device until published, removed or signed out.</Text><View style={styles.row}><Button title="Keep editor open" onPress={() => setConfirmClose(false)} /><Button title="Discard drafts and close" variant="secondary" onPress={onClose} /></View></View> : null}
      {page ? <View style={styles.panel}><Text style={styles.heading}>Page queue</Text>
        {!page.items.length ? <Text style={styles.copy}>{page.nextCursor ? "No matching pages found yet. Continue searching." : "No more matching pages for these filters."}</Text> : null}
        {page.items.length > 0 && page.scanLimitReached ? <Text style={styles.copy}>More matching pages may be available. Continue searching.</Text> : null}
        {page.items.map(row => <View key={`${row.type}:${row.key}`} style={styles.queueItem}><View style={styles.grow}><Text style={styles.heading}>{row.identity.name}</Text><Text style={styles.copy}>{[row.identity.city, row.identity.country, row.identity.date].filter(Boolean).join(" · ")}</Text><Text style={styles.small}>{row.completion ? [row.completion.identityStatus, row.completion.textStatus, row.completion.photoStatus].map(value => value.replaceAll("_", " ")).join(" · ") : row.missingFields.join(", ") || "Existing content retained"}</Text></View><Button small title="Edit text" disabled={busy} onPress={() => select(row)} /></View>)}
        {page.nextCursor ? <Button title={page.scanLimitReached ? "Continue search" : "Next page"} variant="secondary" disabled={busy} onPress={() => load(page.nextCursor)} /> : null}
      </View> : null}
      {entity ? <View style={styles.panel}><Text style={styles.heading}>{entity.identity.name}</Text><Text selectable style={styles.small}>{entity.type} · {entity.key} · revision {entity.revision}</Text>
        {!entity.identityCurrent ? <Text style={styles.error}>The catalog identity changed. Existing staff text is hidden; review its sources before publishing again.</Text> : null}
        {entity.protectedReason ? <Text style={styles.error}>{entity.protectedReason}</Text> : null}
        {entity.completion ? <View style={styles.review}><Text style={styles.copy}>{[entity.completion.identityStatus, entity.completion.textStatus, entity.completion.photoStatus].map(value => value.replaceAll("_", " ")).join(" · ")}</Text><Text style={styles.copy}>{entity.completion.note}</Text>
          {entity.completion.photo ? <><Image key={entity.completion.hash} source={{ uri: entity.completion.photo.uri }} accessibilityLabel={`Accepted catalog photo of ${entity.identity.name}`} style={styles.photo} onLoad={() => setPhotoLoaded(entity.completion.hash)} onError={() => { setPhotoLoaded(""); setError("The accepted photo could not be displayed. Check it before completing this page."); }} /><Text selectable style={styles.small}>{entity.completion.photo.creator} · {entity.completion.photo.license} · {entity.completion.photo.sourcePage}</Text><Text style={styles.copy}>{photoLoaded === entity.completion.hash ? "Accepted photo displayed in this preview; verify the public page after publication." : "Waiting for accepted photo preview."}</Text></> : <Text style={styles.copy}>Existing image workers remain responsible for an accepted photo. A raw image link does not count as verified.</Text>}
        </View> : null}
        <Text style={styles.copy}>Existing facts (read-only)</Text><Text selectable style={styles.facts}>{Object.entries(entity.protectedFacts).filter(([, value]) => value != null && value !== "").map(([key, value]) => `${key}: ${value}`).join("\n") || "No provider text recorded."}</Text>
        <Text style={styles.label}>Sourced page text</Text><TextInput accessibilityLabel="Sourced page text" value={summary} onChangeText={value => { setSummary(value); setDirty(true); }} multiline maxLength={2400} editable={!busy} style={[styles.input, styles.multiline]} />
        <Text style={styles.label}>Sources — one “Name | https://page” per line</Text><TextInput accessibilityLabel="Named source URLs" value={sourceLines} onChangeText={value => { setSourceLines(value); setDirty(true); }} multiline maxLength={14000} autoCapitalize="none" editable={!busy} style={[styles.input, styles.multiline]} />
        <Text style={styles.label}>Reason for change</Text><TextInput accessibilityLabel="Reason for catalog change" value={reason} onChangeText={value => { setReason(value); setDirty(true); }} maxLength={300} editable={!busy} style={styles.input} />
        {hiddenDraft ? <Text style={styles.copy}>This saved draft hides the text from public pages.</Text> : null}
        <View style={styles.row}><Button title={hiddenDraft ? "Add hide to batch" : "Add to batch"} disabled={busy || !durable || !!entity.protectedReason || (entity.completion && (!entity.completion.canDraft || photoLoaded !== entity.completion.hash)) || session.emailVerified !== true} onPress={() => stage(hiddenDraft)} />{entity.content && !entity.content.hidden && !entity.completion && !hiddenDraft ? <Button title="Prepare hiding this text" variant="secondary" disabled={busy} onPress={() => stage(true)} /> : null}</View>
      </View> : null}
      <View style={styles.panel}><Text style={styles.heading}>Draft batch · {batch.length}</Text><Text style={styles.copy}>Saved for this account on this device, including receipt keys for safe retry after reload. Signing out removes local drafts. Verify every source and identity before publishing.</Text>
        {savedBatch.entries.map(entry => <View key={entry.id} style={styles.review}><Text style={styles.copy}>{entry.draft.type}: {entry.draft.key} · {entry.status}</Text><Text style={styles.copy}>{entry.error || ""}</Text><View style={styles.row}><Button small title="Edit saved draft" disabled={busy || ["sending", "uncertain"].includes(entry.status)} onPress={() => edit(entry)} /><Button small title="Remove saved draft" disabled={busy || ["sending", "uncertain"].includes(entry.status)} onPress={() => remove(entry.id)} />{entry.status === "uncertain" ? <Button title="Retry uncertain save" disabled={busy} onPress={() => publish(entry.id)} /> : null}</View></View>)}
        <View style={styles.row}><Button title="Review prepared batch" disabled={busy || !batch.length || !durable || session.emailVerified !== true} onPress={prepare} /><Button title="Clear batch" variant="secondary" disabled={busy || !batch.length} onPress={() => remove(null)} /></View>
        {prepared?.map(row => <View key={row.index} style={styles.review}>
          {!row.ok ? <Text style={styles.error}>Entry {row.index + 1}: {row.error}</Text> : <>
            <Text style={styles.heading}>{row.current.identity.name}</Text><Text style={styles.copy}>Before: {row.current.content?.summary || "No staff text"}</Text><Text selectable style={styles.copy}>After: {row.draft.hidden ? "Hidden from public pages" : row.draft.summary}</Text>
            {row.draft.sources.map(source => <Text selectable key={source.url} style={styles.small}>{source.label}: {source.url}</Text>)}
            <Button title={row.draft.hidden ? "Confirm hide" : "Confirm sources and publish"} disabled={busy} onPress={() => publish(savedBatch.entries.find(entry => entry.draft.type === row.draft.type && entry.draft.key === row.draft.key)?.id)} />
          </>}
        </View>)}
        {savedBatch.entries.length > 1 ? <Button title="Confirm all sources and publish sequentially" disabled={busy || savedBatch.entries.some(entry => entry.status !== "reviewed")} onPress={() => publish(null)} /> : null}
        {savedBatch.receipts.map(record => <View key={record.id} style={styles.review}><Text style={styles.notice}>{record.draft.key}: saved revision {record.receipt.revision} · receipt {record.receipt.auditId}</Text><Text style={styles.copy}>Historical save receipt. {record.verification === "verified" ? `Public text matched when checked at ${new Date(record.verifiedAt).toISOString()}.` : record.verification === "changed" ? "Current public text differs; review the page." : "Current public text has not been verified."} Photo and current public page still require review.</Text></View>)}
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
  photo: { width: "100%", maxWidth: 380, height: 220, resizeMode: "contain" },
  queueItem: { flexDirection: "row", gap: space(3), alignItems: "center", paddingVertical: space(2) }, grow: { flex: 1 }, facts: { color: colors.textDim, fontSize: 12, lineHeight: 19 },
  review: { borderTopColor: colors.line, borderTopWidth: 1, paddingTop: space(3), gap: space(2) } });
