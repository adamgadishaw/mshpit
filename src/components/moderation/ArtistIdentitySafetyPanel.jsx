import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radius } from '../../theme';
import { artistSetupFailure } from '../../domain/artistAccountSetup.mjs';
import ArtistIdentityReviewCard from './ArtistIdentityReviewCard';

export default function ArtistIdentitySafetyPanel({ searchArtists, reviewIdentity, returnToCatalogue }) {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmingReturn, setConfirmingReturn] = useState(false);
  const operation = useRef(null);
  useEffect(() => () => operation.current?.abort(), []);
  const run = async (work) => {
    if (operation.current) return;
    const controller = new AbortController(); operation.current = controller;
    setBusy(true); setError(''); setNotice('');
    try { await work(controller.signal); }
    catch (failure) { if (!controller.signal.aborted) setError(artistSetupFailure(failure).message); }
    finally { if (operation.current === controller) { operation.current = null; if (!controller.signal.aborted) setBusy(false); } }
  };
  const find = () => run(async signal => {
    const found = await searchArtists(query, { signal });
    if (signal.aborted) return;
    setRows((Array.isArray(found) ? found : []).filter(row => row.key || row.profileKey).slice(0, 8)); setSearched(true); setSelected(null);
  });
  const review = (request, action, evidence) => run(async signal => {
    const result = await reviewIdentity(request.artistKey, action, { ...evidence, signal });
    if (signal.aborted) return;
    if (!result?.ok) throw new Error(artistSetupFailure(result).message);
    setSelected(current => ({ ...current, identityReview: result.value?.identityReview || result.identityReview }));
    setNotice(action === 'hold' ? 'Identity hold applied. The artist check is revoked and public identity delivery is restricted.' : 'Identity hold released. No artist check was granted and previously hidden posts were not automatically restored.');
  });
  // Two taps: the first explains exactly what is removed, the second does it.
  const returnPage = () => {
    if (!confirmingReturn) { setConfirmingReturn(true); setError(''); setNotice(''); return; }
    run(async signal => {
      const result = await returnToCatalogue(selected.artistKey, { reason: 'Staff returned this page to the catalogue: the claim was made by mistake.', signal });
      if (signal.aborted) return;
      if (!result?.ok) throw new Error(artistSetupFailure(result).message);
      setConfirmingReturn(false);
      setNotice(`${selected.artistName} is a catalogue page again. The owner, bio, feed and the photos they uploaded were removed.`);
    });
  };
  return <View style={styles.box}>
    <Text style={styles.title}>Artist identity safety</Text>
    <Text style={styles.text}>Investigate an existing artist page even when no claim is pending. This private staff search includes held pages that public search hides. Choose the exact page and record your evidence before holding or releasing it.</Text>
    <TextInput accessibilityLabel="Artist identity safety search" style={styles.input} value={query} onChangeText={setQuery} editable={!busy} placeholder="Artist name" placeholderTextColor={colors.textFaint} maxLength={80} onSubmitEditing={find} />
    <Pressable accessibilityRole="button" disabled={busy || query.trim().length < 2} accessibilityState={{ disabled: busy || query.trim().length < 2 }} style={styles.button} onPress={find}><Text style={styles.buttonText}>{busy ? 'Working…' : 'Find artist page to review'}</Text></Pressable>
    {searched && !rows.length && !busy && <Text style={styles.text}>No matching catalogue pages found. Check the name and try again.</Text>}
    {rows.map(row => <Pressable accessibilityRole="button" accessibilityLabel={`Review identity of ${row.name}`} disabled={busy} key={row.key || row.profileKey} onPress={() => { setSelected({ artistKey: row.key || row.profileKey, artistName: row.name, identityReview: row.identityReview }); setConfirmingReturn(false); setError(''); setNotice(''); }} style={styles.result}><Text style={styles.title}>{row.name}</Text><Text selectable style={styles.text}>{row.key || row.profileKey}{row.identityReview?.held ? ' · Identity hold' : ''}</Text></Pressable>)}
    {!!error && <Text style={styles.error} accessibilityRole="alert">{error} Your evidence stays below so you can retry.</Text>}
    {!!notice && <Text style={styles.text} accessibilityLiveRegion="polite">{notice}</Text>}
    {!!selected && <ArtistIdentityReviewCard key={selected.artistKey} request={selected} identityOnly busy={busy} onReview={review} />}
    {!!selected && !!returnToCatalogue && <View style={styles.returnBox}>
      <Text style={styles.text}>{confirmingReturn
        ? `This removes the owner of ${selected.artistName}, their bio, their posts feed switch and the photos they uploaded. Tap again to confirm.`
        : 'Claimed by mistake? Put this page back to a plain catalogue page.'}</Text>
      <Pressable accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} style={styles.button} onPress={returnPage}>
        <Text style={[styles.buttonText, confirmingReturn && styles.dangerText]}>{confirmingReturn ? `Yes, return ${selected.artistName} to the catalogue` : 'Return to catalogue page'}</Text>
      </Pressable>
    </View>}
  </View>;
}
const styles = StyleSheet.create({ box: { padding: 16, gap: 12, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, backgroundColor: colors.surface, marginBottom: 20 }, title: { color: colors.text, fontSize: 17, fontWeight: '800' }, text: { color: colors.textDim, fontSize: 13, lineHeight: 20 }, input: { color: colors.text, fontSize: 14, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, padding: 12 }, button: { minHeight: 44, justifyContent: 'center' }, buttonText: { color: colors.amber, fontWeight: '800', fontSize: 14 }, result: { padding: 12, gap: 5, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm }, error: { color: colors.danger, fontSize: 13, lineHeight: 21 }, returnBox: { gap: 4, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.line }, dangerText: { color: colors.danger } });
