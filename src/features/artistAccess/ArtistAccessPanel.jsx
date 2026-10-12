import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import Button from "../../components/Button";
import SheetHeader from "../../components/SheetHeader";
import { colors, focusRing, radius, space } from "../../theme";
import { createLoadState, beginLoadState, resolveLoadState, rejectLoadState, isLoadCancellation } from "../../domain/loadState.mjs";
import { searchArtistAccess, revokeArtistAccess, reviewRetainedArtistContent, previewArtistAccess, changeRetainedArtistPublication } from "./artistAccessApi.mjs";

export default function ArtistAccessPanel({ accountId, onClose, onOpenJobs }) {
  const [query, setQuery] = useState(""), [resource, setResource] = useState(() => createLoadState({ scope: accountId }));
  const [selected, setSelected] = useState(null), [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [focused, setFocused] = useState(null);
  const [retained, setRetained] = useState(null);
  const [preview, setPreview] = useState(null), [disposition, setDisposition] = useState("hide"), [visibleItems, setVisibleItems] = useState([]);
  const [publicationChanges, setPublicationChanges] = useState({}), [publicationReason, setPublicationReason] = useState(""), [publicationConfirm, setPublicationConfirm] = useState(false);
  const request = useRef(null), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, [accountId]);
  const search = async () => {
    if (request.current || query.trim().length < 2) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(""); setNotice(""); setSelected(null); setConfirming(false); setRetained(null); setPreview(null); setPublicationChanges({});
    setResource(current => beginLoadState(current, { scope: accountId, retainData: false }));
    try {
      const result = await searchArtistAccess(query, { signal: controller.signal });
      if (!controller.signal.aborted && mounted.current) setResource(resolveLoadState({ scope: accountId, data: result }));
    } catch (failure) {
      if (!isLoadCancellation(failure, controller.signal) && mounted.current) setResource(current => rejectLoadState(current, { scope: accountId, error: failure, retainData: false }));
    } finally { if (request.current === controller) request.current = null; if (mounted.current) setBusy(false); }
  };
  const revoke = async () => {
    if (request.current || !confirming || !preview || !selected?.ownerId || reason.trim().length < 8) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(""); setNotice("");
    try {
      await revokeArtistAccess(selected, reason, { signal: controller.signal, contentHash: preview.contentHash, disposition, visibleItems });
      if (controller.signal.aborted || !mounted.current) return;
      const updated = { ...selected, ownerId: null, owner: null, retainedReviews: (selected.retainedReviews || 0) + 1 };
      setSelected(updated); setConfirming(false); setReason("");
      setResource(current => resolveLoadState({ scope: accountId, data: { ...current.data, artists: current.data.artists.map(row => row.key === updated.key ? updated : row) } }));
      setNotice(`Access to ${selected.name} was revoked and recorded in the moderation audit. Content is preserved; publication follows your confirmed choices. The page is now unassigned.`);
    } catch (failure) {
      if (!isLoadCancellation(failure, controller.signal) && mounted.current) { setError(failure.message); setConfirming(false); }
    } finally { if (request.current === controller) request.current = null; if (mounted.current) setBusy(false); }
  };
  const prepareRevocation = async (cursor = 0) => {
    if (request.current || !selected?.ownerId) return;
    const controller = new AbortController();request.current = controller;setBusy(true);setError("");
    try {
      const result = await previewArtistAccess(selected.key, { signal: controller.signal, cursor });
      if (controller.signal.aborted || !mounted.current) return;
      if (result.ownerId !== selected.ownerId || result.updatedAt !== selected.updatedAt || (cursor && result.contentHash !== preview?.contentHash)) throw new Error("Assignment or content changed. Search again and review a fresh preview.");
      setPreview(current => ({ ...result, items: cursor ? [...current.items, ...result.items] : result.items }));setConfirming(true);
    } catch (failure) { if (!isLoadCancellation(failure, controller.signal) && mounted.current) { setError(failure.message);setConfirming(false); } }
    finally { if (request.current === controller) request.current = null;if (mounted.current) setBusy(false); }
  };
  const publish = async () => {
    if (request.current || !publicationConfirm || !Object.keys(publicationChanges).length || publicationReason.trim().length < 8) return;
    const controller = new AbortController();request.current = controller;setBusy(true);setError("");
    try {
      await changeRetainedArtistPublication(selected.key, retained, Object.values(publicationChanges), publicationReason, { signal: controller.signal });
      const result = await reviewRetainedArtistContent(selected.key, { signal: controller.signal, revocationId: retained.snapshot.id });
      if (controller.signal.aborted || !mounted.current) return;
      setRetained(result);setPublicationChanges({});setPublicationReason("");setPublicationConfirm(false);setNotice("Publication updated without granting management access. The attributed snapshot is preserved.");
    } catch (failure) { if (!isLoadCancellation(failure, controller.signal) && mounted.current) { setError(failure.message);setPublicationConfirm(false); } }
    finally { if (request.current === controller) request.current = null;if (mounted.current) setBusy(false); }
  };
  const togglePublication = item => {
    const key = `${item.type}:${item.id}`, current = publicationChanges[key]?.publication || item.publication;
    const next = current === "public" ? "hidden" : "public";
    setPublicationChanges(changes => { const result = { ...changes };if (next === item.publication) delete result[key];else result[key] = { type: item.type, id: item.id, revision: item.revision, publication: next };return result; });setPublicationConfirm(false);
  };
  const review = async (revocationId = "", cursor = 0) => {
    if (request.current || !selected) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setError("");
    try {
      const result = await reviewRetainedArtistContent(selected.key, { signal: controller.signal, revocationId, cursor });
      if (!controller.signal.aborted && mounted.current) {
        setRetained(current => ({ ...result, content: cursor ? [...(current?.content || []), ...result.content] : result.content }));
        if (!cursor) { setPublicationChanges({});setPublicationConfirm(false); }
      }
    } catch (failure) { if (!isLoadCancellation(failure, controller.signal) && mounted.current) setError(failure.message); }
    finally { if (request.current === controller) request.current = null; if (mounted.current) setBusy(false); }
  };
  return <View style={styles.root}>
    <SheetHeader title="Administration" onClose={onClose} leadDisabled={busy} />
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic">
      <Button title="Back to jobs" variant="secondary" disabled={busy} onPress={onOpenJobs} />
      <Text style={styles.heading} accessibilityRole="header">Artist access</Text>
      <Text style={styles.hint}>Review the stored page assignment before revoking access. Assignment and identity verification are separate; a managed label alone is not evidence of authority.</Text>
      <TextInput accessibilityLabel="Artist access search" value={query} maxLength={80} editable={!busy} onChangeText={setQuery} onSubmitEditing={() => void search()} placeholder="Artist name or page key" placeholderTextColor={colors.textFaint} onFocus={() => setFocused("query")} onBlur={() => setFocused(null)} style={[styles.input, focused === "query" && focusRing]} />
      <Button title="Find artist access" loading={busy} disabled={query.trim().length < 2} onPress={() => void search()} />
      {resource.status === "loading" ? <ActivityIndicator color={colors.amber} accessibilityLabel="Loading artist access" /> : null}
      {resource.error ? <View><Text style={styles.error} accessibilityRole="alert">{resource.error.message}</Text><Button title="Retry artist search" disabled={busy} onPress={() => void search()} /></View> : null}
      {resource.data?.artists.length === 0 ? <Text style={styles.hint}>No matching pages found. Check the name or page key.</Text> : null}
      {resource.data?.hasMore ? <Text style={styles.hint}>More matches exist. Refine the search to find the exact page.</Text> : null}
      {(resource.data?.artists || []).map(row => <Button key={row.key} title={`${row.name} · ${row.ownerId ? "assigned" : "unassigned"}`} accessibilityLabel={`Review access for ${row.name}`} variant="secondary" disabled={busy} onPress={() => { setSelected(row); setReason(""); setConfirming(false); setError(""); setNotice(""); setRetained(null);setPreview(null);setDisposition("hide");setVisibleItems([]);setPublicationChanges({});setPublicationConfirm(false); }} />)}
      {selected ? <View style={styles.box}>
        <Text style={styles.heading}>{selected.name}</Text><Text selectable style={styles.hint}>Page key: {selected.key}</Text>
        {selected.ownerId ? <>
          <Text selectable style={styles.text}>Assigned account: {selected.owner?.name || "Unavailable account"}{selected.owner?.handle ? ` (@${selected.owner.handle})` : ""}</Text>
          <Text selectable style={styles.hint}>Account ID: {selected.ownerId}</Text>
          <Text style={styles.hint}>Role: {selected.owner?.role || "unknown"}. Identity check: {selected.owner?.verified && selected.owner?.matchesArtist && selected.owner?.active && !selected.identityReview?.held ? "verified" : "unverified"}.{selected.removed ? " Page is removed." : ""}</Text>
          {selected.owner && !selected.owner.matchesArtist ? <Text style={styles.hint}>This assignment does not match an artist account for this page. Its other role and artist permissions will be preserved.</Text> : null}
          {selected.owner?.active === false ? <Text style={styles.hint}>The assigned account is currently restricted or inactive.</Text> : null}
          <Text style={styles.text}>Reason for revocation</Text>
          <TextInput accessibilityLabel="Artist access revocation reason" value={reason} onChangeText={value => { setReason(value); setConfirming(false); }} maxLength={300} multiline editable={!busy} onFocus={() => setFocused("reason")} onBlur={() => setFocused(null)} style={[styles.input, styles.reason, focused === "reason" && focusRing]} />
          {confirming ? <View style={styles.confirmation}>
            <Text style={styles.text}>Revoke {selected.owner?.handle ? `@${selected.owner.handle}` : selected.ownerId}'s access to {selected.name}?</Text>
            <Text style={styles.hint}>Management ends regardless of publication. Everything is preserved with original attribution. These choices affect only former-manager contributions; private/moderated items, catalogue content and other people's contributions are not made public or removed. Ordinary sessions and unrelated roles remain active.</Text>
            {[['hide','Hide former-manager content'],['keep','Keep previously public content'],['selected','Choose content item by item']].map(([value,title]) => <Button key={value} title={title} accessibilityLabel={title} variant={disposition === value ? "primary" : "secondary"} disabled={busy} onPress={() => setDisposition(value)} />)}
            <Text style={styles.hint}>{preview?.contentCount || 0} updates/dates and {preview?.profileItems.length || 0} profile items in the snapshot. Published contributions show their original author, without implying verified artist identity.</Text>
            {[...(preview?.profileItems || []),...(preview?.items || [])].map(item => <View key={item.itemKey} style={styles.box}>
              <Text selectable style={styles.text}>{item.type}: {item.id}. Original contributor: {item.authorId || item.userId}</Text>
              <Text selectable style={styles.text}>{item.value || item.text || [item.artist,item.venue,item.date].filter(Boolean).join(" · ")}</Text>
              {!item.eligible ? <Text style={styles.hint}>Previously private, moderated or restricted: stays hidden.</Text> : null}
              {disposition === "selected" ? <Button title={`${visibleItems.includes(item.itemKey) ? 'Keep public' : 'Keep hidden'}: ${item.itemKey}`} accessibilityLabel={`Toggle publication for ${item.itemKey}`} variant="secondary" disabled={busy || !item.eligible} onPress={() => setVisibleItems(current => current.includes(item.itemKey) ? current.filter(key => key !== item.itemKey) : [...current,item.itemKey])} /> : null}
            </View>)}
            {preview?.cursor != null ? <Button title="Load more preview items" variant="secondary" disabled={busy} onPress={() => void prepareRevocation(preview.cursor)} /> : null}
            <Button title="Cancel revocation" variant="secondary" disabled={busy} onPress={() => setConfirming(false)} />
            <Button title="Confirm revoke access" variant="danger" loading={busy} disabled={reason.trim().length < 8} onPress={() => void revoke()} />
          </View> : <Button title="Review revocation" variant="secondary" disabled={busy || reason.trim().length < 8} onPress={() => void prepareRevocation()} />}
        </> : <Text style={styles.text}>No account is assigned to this page. There is no assignment to revoke.</Text>}
      </View> : null}
      {selected?.retainedReviews > 0 ? <Button title="Review retained content" variant="secondary" disabled={busy} onPress={() => void review()} /> : null}
      {retained ? <View style={styles.box}>
        <Text style={styles.heading} accessibilityRole="header">Retained content review</Text>
        <Text style={styles.hint}>Preview retained contributions, then explicitly confirm publication changes. Viewing or assigning a manager does not publish them. Prior private/moderated content remains hidden.</Text>
        {retained.revocations.map(row => <Button key={row.id} title={`Review snapshot ${new Date(row.created_at).toLocaleDateString()}`} accessibilityLabel={`Review retained snapshot ${row.id}`} variant="secondary" disabled={busy} onPress={() => void review(row.id)} />)}
        {retained.snapshot ? <>
          <Text selectable style={styles.text}>Former manager: {retained.snapshot.ownerId}</Text>
          <Text selectable style={styles.text}>Reason: {retained.snapshot.reason}</Text>
          {retained.snapshot.profile.bio ? <Text selectable style={styles.text}>Retained biography: {retained.snapshot.profile.bio}</Text> : null}
          {[retained.snapshot.profile.avatarUri, retained.snapshot.profile.banner].filter(Boolean).map((url, index) => <Text key={index} selectable style={styles.hint}>Retained page artwork: {url}</Text>)}
          {retained.profileItems.map(item => <View key={`profile:${item.id}`} style={styles.box}>
            <Text selectable style={styles.text}>Profile {item.id}: {item.value}. Original contributor: {item.authorId}</Text>
            <Button title={`${publicationChanges[`profile:${item.id}`]?.publication || item.publication}: profile ${item.id}`} accessibilityLabel={`Change retained publication for profile:${item.id}`} variant="secondary" disabled={busy || (!item.eligible && (publicationChanges[`profile:${item.id}`]?.publication || item.publication) === "hidden")} onPress={() => togglePublication(item)} />
          </View>)}
          {retained.content.map(row => <View key={`${row.type}:${row.id}`} style={styles.box}>
            <Text selectable style={styles.text}>{row.type}: {row.id}. Original author: {row.userId}</Text>
            {row.text ? <Text selectable style={styles.text}>{row.text}</Text> : null}
            {row.date ? <Text selectable style={styles.text}>{row.artist} · {row.venue} · {row.date} ({row.source})</Text> : null}
            {row.photos.map((url, index) => <Text key={index} selectable style={styles.hint}>Retained media: {url}</Text>)}
            <Button title={`${publicationChanges[`${row.type}:${row.id}`]?.publication || row.publication}: ${row.id}`} accessibilityLabel={`Change retained publication for ${row.type}:${row.id}`} variant="secondary" disabled={busy || row.superseded || (!row.eligible && (publicationChanges[`${row.type}:${row.id}`]?.publication || row.publication) === "hidden")} onPress={() => togglePublication(row)} />
          </View>)}
          {retained.cursor != null ? <Button title="Load more retained content" disabled={busy} onPress={() => void review(retained.snapshot.id, retained.cursor)} /> : null}
          <Text style={styles.text}>Reason for publication changes</Text>
          <TextInput accessibilityLabel="Retained publication reason" value={publicationReason} onChangeText={value => { setPublicationReason(value);setPublicationConfirm(false); }} maxLength={300} multiline editable={!busy} style={[styles.input,styles.reason]} />
          {publicationConfirm ? <View style={styles.confirmation}>
            <Text style={styles.text}>Confirm {Object.keys(publicationChanges).length} publication changes? Management access is not granted.</Text>
            {Object.values(publicationChanges).map(item => <Text key={`${item.type}:${item.id}`} selectable style={styles.text}>{item.type}:{item.id} → {item.publication}</Text>)}
            <Button title="Cancel publication changes" variant="secondary" disabled={busy} onPress={() => setPublicationConfirm(false)} />
            <Button title="Confirm publication changes" loading={busy} onPress={() => void publish()} />
          </View> : <Button title="Preview publication changes" variant="secondary" disabled={busy || !Object.keys(publicationChanges).length || publicationReason.trim().length < 8} onPress={() => setPublicationConfirm(true)} />}
        </> : <Text style={styles.hint}>No retained snapshot for this page.</Text>}
      </View> : null}
      {error ? <Text style={styles.error} accessibilityRole="alert">{error} Your reason is retained. If the assignment changed, search again before retrying.</Text> : null}
      {notice ? <Text style={styles.text} accessibilityRole="status" accessibilityLiveRegion="polite">{notice}</Text> : null}
    </ScrollView>
  </View>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg }, content: { padding: space(5), gap: space(3), paddingBottom: space(12) },
  heading: { color: colors.text, fontSize: 22, fontWeight: "700" }, text: { color: colors.text, fontSize: 14, lineHeight: 22 }, hint: { color: colors.textDim, lineHeight: 21 },
  input: { color: colors.text, backgroundColor: colors.surface, borderColor: colors.lineSoft, borderWidth: 1, borderRadius: radius.md, padding: 12, fontSize: 16 },
  reason: { minHeight: 100, textAlignVertical: "top" }, error: { color: colors.danger, lineHeight: 22 }, box: { gap: 12, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.lineSoft }, confirmation: { gap: 12 },
});
