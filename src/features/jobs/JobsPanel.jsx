import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import Button from "../../components/Button";
import SheetHeader from "../../components/SheetHeader";
import { colors, focusRing, radius, space } from "../../theme";
import { createLoadState, beginLoadState, resolveLoadState, rejectLoadState, isLoadCancellation } from "../../domain/loadState.mjs";
import { JOB_FIELDS } from "../../domain/jobs.mjs";
import { createAdminJob, listAdminJobs, updateAdminJob } from "./jobsApi.mjs";

const emptyDraft = () => Object.fromEntries(JOB_FIELDS.map(field => [field, ""]));
const labels = { title: "Job title", location: "Location", arrangement: "Work arrangement (for example, remote or on-site)", description: "Description, responsibilities and requirements", application: "Application URL (HTTPS) or email" };
const newId = () => `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,14)}`;

export default function JobsPanel({ accountId, onClose, onOpenArtistAccess }) {
  const [resource, setResource] = useState(() => createLoadState({ scope: accountId }));
  const [selected, setSelected] = useState(null), [draft, setDraft] = useState(emptyDraft);
  const [creationId, setCreationId] = useState(newId), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [pendingSelection, setPendingSelection] = useState(null), [confirmLeave, setConfirmLeave] = useState(false);
  const [focusedField, setFocusedField] = useState(null);
  const readRequest = useRef(null), commandRequest = useRef(null), mounted = useRef(true);
  const dirty = JSON.stringify(draft) !== JSON.stringify(selected?.draft || emptyDraft());
  const archived = selected?.state === "archived";
  const load = async (cursor = "") => {
    readRequest.current?.abort();
    const controller = new AbortController(); readRequest.current = controller;
    setResource(current => beginLoadState(current, { scope: accountId }));
    try {
      const page = await listAdminJobs({ signal: controller.signal, cursor });
      if (controller.signal.aborted || !mounted.current) return;
      setResource(current => resolveLoadState({ scope: accountId, data: { ...page, jobs: cursor ? [...(current.data?.jobs || []), ...page.jobs] : page.jobs } }));
    } catch (failure) {
      if (!isLoadCancellation(failure, controller.signal) && mounted.current) setResource(current => rejectLoadState(current, { scope: accountId, error: failure }));
    }
  };
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; readRequest.current?.abort(); commandRequest.current?.abort(); };
  }, [accountId]);
  const choose = (job, discard = false) => {
    if (busy) return;
    if (dirty && !discard) { setPendingSelection({ job }); return; }
    setSelected(job); setDraft(job?.draft || emptyDraft()); setCreationId(newId());
    setPendingSelection(null); setNotice(""); setError("");
  };
  const save = async action => {
    if (commandRequest.current || archived) return;
    readRequest.current?.abort();
    const controller = new AbortController(); commandRequest.current = controller;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = selected
        ? await updateAdminJob({ id: selected.id, revision: selected.revision, draft, action, signal: controller.signal })
        : await createAdminJob({ id: creationId, draft, signal: controller.signal });
      if (controller.signal.aborted || !mounted.current) return;
      setSelected(response.job); setDraft(response.job.draft);
      setResource(current => resolveLoadState({ scope: accountId, data: { ...current.data, jobs: [response.job, ...(current.data?.jobs || []).filter(job => job.id !== response.job.id)] } }));
      setNotice(action === "publish" ? "Published. The public opening now uses these details." : action === "close" ? "Closed. Removed from the open jobs list." : action === "archive" ? "Archived. The record is retained." : "Draft saved. Published details stay unchanged until Publish.");
    } catch (failure) {
      if (!isLoadCancellation(failure, controller.signal) && mounted.current) setError(failure.message);
    } finally {
      if (commandRequest.current === controller) commandRequest.current = null;
      if (mounted.current) setBusy(false);
    }
  };
  return <View style={styles.root}>
    <SheetHeader title="Administration" onClose={() => dirty ? setConfirmLeave("close") : onClose()} leadDisabled={busy} />
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic">
      <Text style={styles.heading} accessibilityRole="header">Jobs</Text>
      <Text style={styles.hint}>Create openings for Work at mshpit. Save drafts privately; Publish makes the current details public.</Text>
      {onOpenArtistAccess ? <Button title="Artist access" variant="secondary" disabled={busy} onPress={() => dirty ? setConfirmLeave("artistAccess") : onOpenArtistAccess()} /> : null}
      {confirmLeave ? <View style={styles.box}><Text style={styles.text}>Leave and discard unsaved changes?</Text><Button title="Keep editing" onPress={() => setConfirmLeave(false)} /><Button title="Discard and leave" variant="danger" onPress={confirmLeave === "artistAccess" ? onOpenArtistAccess : onClose} /></View> : null}
      {pendingSelection ? <View style={styles.box}><Text style={styles.text}>Discard unsaved changes before switching jobs?</Text><Button title="Keep editing" onPress={() => setPendingSelection(null)} /><Button title="Discard changes" variant="danger" onPress={() => choose(pendingSelection.job, true)} /></View> : null}
      {!resource.data && ["idle", "loading"].includes(resource.status) ? <ActivityIndicator color={colors.amber} accessibilityLabel="Loading jobs" /> : null}
      {resource.error ? <View><Text style={styles.error} accessibilityRole="alert">{resource.error.message}</Text><Button title="Retry jobs list" variant="secondary" disabled={busy} onPress={() => void load()} /></View> : null}
      {resource.data?.jobs.length === 0 ? <Text style={styles.hint}>No job openings have been created.</Text> : null}
      <Button title="New job draft" variant="secondary" disabled={busy} onPress={() => choose(null)} />
      {(resource.data?.jobs || []).map(job => <Button key={job.id} title={`${job.draft.title || "Untitled draft"} · ${job.state}`} variant="secondary" disabled={busy} onPress={() => choose(job)} />)}
      {resource.data?.cursor ? <Button title="Load more jobs" disabled={busy || resource.status === "refreshing"} onPress={() => void load(resource.data.cursor)} /> : null}
      <Text style={styles.heading}>{selected ? `Edit ${selected.state} opening` : "New draft"}</Text>
      {selected?.published ? <Text style={styles.hint}>Last published title: {selected.published.title}. Draft edits remain private until Publish.</Text> : null}
      {JOB_FIELDS.map(field => <View key={field} style={styles.field}>
        <Text style={styles.text}>{labels[field]}</Text>
        <TextInput accessibilityLabel={labels[field]} value={draft[field]} editable={!busy && !archived} multiline={field === "description"} maxLength={field === "description" ? 12000 : field === "application" ? 2048 : 160} autoCapitalize={field === "application" ? "none" : "sentences"} onFocus={() => setFocusedField(field)} onBlur={() => setFocusedField(null)} onChangeText={value => setDraft(current => ({ ...current, [field]: value }))} style={[styles.input, field === "description" && styles.description, focusedField === field && focusRing]} />
      </View>)}
      {error ? <Text style={styles.error} accessibilityRole="alert">{error} Your draft is still here.</Text> : null}
      {notice ? <Text style={styles.text} accessibilityRole="status" accessibilityLiveRegion="polite">{notice}</Text> : null}
      {!archived ? <View style={styles.actions}>
        <Button title="Save draft" loading={busy} onPress={() => void save("save")} />
        <Button title={selected?.state === "closed" ? "Publish and reopen" : "Publish"} disabled={busy || !selected} onPress={() => void save("publish")} />
        {selected?.state === "published" ? <Button title="Close opening" variant="secondary" disabled={busy || dirty} onPress={() => void save("close")} /> : null}
        {selected && selected.state !== "published" ? <Button title="Archive" variant="secondary" disabled={busy || dirty} onPress={() => void save("archive")} /> : null}
      </View> : <Text style={styles.hint}>Archived records are read-only.</Text>}
      {dirty && selected ? <Button title="Discard unsaved edits" variant="secondary" disabled={busy} onPress={() => choose(selected, true)} /> : null}
    </ScrollView>
  </View>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg }, content: { padding: space(5), gap: space(3), paddingBottom: space(12) },
  heading: { color: colors.text, fontSize: 22, fontWeight: "700" }, text: { color: colors.text, fontSize: 14 }, hint: { color: colors.textDim, lineHeight: 21 },
  field: { gap: 8 }, input: { color: colors.text, backgroundColor: colors.surface, borderColor: colors.lineSoft, borderWidth: 1, borderRadius: radius.md, padding: 12, fontSize: 16 },
  description: { minHeight: 160, textAlignVertical: "top" }, error: { color: colors.danger, lineHeight: 22 }, actions: { gap: 10 }, box: { padding: 12, gap: 10, borderWidth: 1, borderColor: colors.lineSoft },
});
