import { useEffect, useState } from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, radius, mono } from "../../theme";
import { artistReviewReady, instagramHandle, instagramStoryUrl, officialEvidenceUrl, verificationExpiry } from "../../domain/artistVerificationProof.mjs";

function Confirmation({ label, value, onChange, disabled }) {
  return <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked: value, disabled }} {...(Platform.OS === 'web' ? { 'aria-checked': value } : {})} disabled={disabled} onPress={() => onChange(!value)} style={styles.confirmation}><Text style={styles.check}>{value ? '☑' : '☐'}</Text><Text style={styles.text}>{label}</Text></Pressable>;
}

export default function ArtistIdentityReviewCard({ request, member, busy, action, onReview, identityOnly = false }) {
  const [reason, setReason] = useState('');
  const [officialAccountConfirmed, setOfficial] = useState(false);
  const [ownershipConfirmed, setOwnership] = useState(false);
  const [identityReviewConfirmed, setIdentity] = useState(false);
  const [liveCodeObserved, setObserved] = useState(false);
  const [observedAt, setObservedAt] = useState(null);
  const [observedCode, setCode] = useState('');
  const [reviewedUrl, setUrl] = useState('');
  const [linkError, setLinkError] = useState('');
  const [clock, setClock] = useState(Date.now());
  const proof = request.proof;
  const instagram = proof?.method === 'instagram_story';
  const challenge = proof?.challenge;
  const expiresAt = verificationExpiry(challenge?.expiresAt);
  const held = request.identityReview?.held === true;
  useEffect(() => { setIdentity(false); }, [held]);
  useEffect(() => {
    if (!instagram || expiresAt <= Date.now()) return;
    const timer = setTimeout(() => setClock(Date.now()), Math.min(expiresAt - Date.now() + 10, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [instagram, expiresAt]);
  const evidence = { method: instagram ? 'instagram_story' : 'manual', reason, officialAccountConfirmed, ownershipConfirmed, identityReviewConfirmed,
    ...(instagram ? { liveCodeObserved, observedCode: observedCode.trim(), observedAt } : { reviewedUrl }) };
  const ready = artistReviewReady(request, evidence, Math.max(clock, Date.now()));
  const reasonReady = reason.trim().length >= 12;
  const releaseReady = reasonReady && identityReviewConfirmed && officialAccountConfirmed && ownershipConfirmed && !!officialEvidenceUrl(reviewedUrl);
  const open = (url) => { setLinkError(''); void Linking.openURL(url).catch(() => setLinkError('The evidence link could not be opened. Copy the displayed link and inspect it directly.')); };
  const story = instagramStoryUrl(proof?.storyUrl, proof?.instagramHandle || challenge?.instagramHandle);
  const handle = instagramHandle(proof?.instagramHandle || challenge?.instagramHandle);
  return <View style={styles.card}>
    <Text selectable style={styles.title}>{request.artistName}</Text>
    {!identityOnly && <Text style={styles.text}>{request.kind === 'verification' ? 'Artist check · existing page owner' : 'Ownership claim · grants page management access'}</Text>}
    {!identityOnly && <Text style={styles.text}>Requested by {member ? `${member.name} (@${member.handle})` : 'unknown account'}</Text>}
    <Text style={[styles.status, held && styles.warning]}>{request.identityReview ? held ? 'IDENTITY HOLD · NOT PUBLIC' : 'NO IDENTITY HOLD' : 'HOLD STATUS NOT LOADED'}</Text>
    {!!request.identityReview?.reasons?.length && <Text selectable style={styles.text}>Review signals: {request.identityReview.reasons.join(', ')}</Text>}
    {!!request.identityReview?.matches?.length && <Text selectable style={styles.text}>Possible catalogue conflicts: {request.identityReview.matches.map(item => typeof item === 'string' ? item : item.name || item.artistName || item.key).filter(Boolean).join(', ')}</Text>}
    {!!request.note && <Text selectable style={styles.text}>Submitted evidence: {request.note}</Text>}
    {instagram ? <View style={styles.proof}>
      <Text style={styles.title}>Instagram Story verification</Text>
      <Text selectable style={styles.text}>Official account claimed: @{handle || 'invalid handle'}</Text>
      <Text selectable style={styles.code}>{challenge?.code || 'No challenge code supplied'}</Text>
      <Text selectable style={styles.text}>Expected artist: {challenge?.artistName || request.artistName}. Expires {expiresAt ? new Date(expiresAt).toLocaleString() : 'unknown'}.</Text>
      <Text selectable style={styles.text}>{story || 'No valid exact Story URL supplied'}</Text>
      <View style={styles.actions}>
        {!!handle && <Pressable accessibilityRole="button" style={styles.link} onPress={() => open(`https://www.instagram.com/${handle}/`)}><Text style={styles.linkText}>Open claimed Instagram account</Text></Pressable>}
        {!!story && <Pressable accessibilityRole="button" style={styles.link} onPress={() => open(story)}><Text style={styles.linkText}>Open live Story</Text></Pressable>}
      </View>
      {expiresAt <= Math.max(clock, Date.now()) && <Text style={styles.warning}>Expired proof cannot be approved. Ask the artist to generate a fresh code and submit a new live Story.</Text>}
      <Text style={styles.text}>Inspect the live Story yourself. A screenshot, follower count, matching name, profile URL, or supplied code alone is not proof. Do not request their password.</Text>
      <TextInput style={styles.input} value={observedCode} onChangeText={setCode} editable={!busy} accessibilityLabel={`Live Story code observed for ${request.artistName}`} placeholder="Type the code you actually saw in the Story" placeholderTextColor={colors.textFaint} autoCapitalize="characters" autoCorrect={false} maxLength={80} />
      <Confirmation label="I directly viewed the live Story with this artist name and matching code before expiry" value={liveCodeObserved} disabled={busy} onChange={(checked) => { setObserved(checked); setObservedAt(checked ? Date.now() : null); }} />
    </View> : <>
      <Text style={styles.text}>Independently inspect the established official website or social account, then record the URL you checked. Notes alone cannot grant a check.</Text>
      <TextInput style={styles.input} value={reviewedUrl} onChangeText={setUrl} editable={!busy} accessibilityLabel={`Official evidence URL reviewed for ${request.artistName}`} placeholder="https://official-artist.example/..." placeholderTextColor={colors.textFaint} keyboardType="url" autoCapitalize="none" autoCorrect={false} maxLength={512} />
    </>}
    {!!linkError && <Text style={styles.warning} accessibilityRole="alert">{linkError}</Text>}
    <Confirmation label="I confirmed this is the artist's established official account or website, not a look-alike" value={officialAccountConfirmed} disabled={busy} onChange={setOfficial} />
    <Confirmation label="I confirmed this member controls or is authorized to represent the artist" value={ownershipConfirmed} disabled={busy} onChange={setOwnership} />
    {(held || identityOnly) && <Confirmation label="I independently resolved the identity conflict and authorize releasing this hold" value={identityReviewConfirmed} disabled={busy} onChange={setIdentity} />}
    {held && instagram && <TextInput style={styles.input} value={reviewedUrl} onChangeText={setUrl} editable={!busy} accessibilityLabel={`Official evidence URL reviewed for ${request.artistName}`} placeholder="Official URL independently reviewed to release this hold" placeholderTextColor={colors.textFaint} keyboardType="url" autoCapitalize="none" autoCorrect={false} maxLength={512} />}
    <TextInput style={[styles.input, styles.reason]} value={reason} onChangeText={setReason} editable={!busy} accessibilityLabel={`Artist review reason for ${request.artistName}`} placeholder="Record what you checked and why this decision is justified (at least 12 characters)" placeholderTextColor={colors.textFaint} maxLength={1000} multiline />
    {!identityOnly && <View style={styles.actions}>
      <Pressable accessibilityRole="button" disabled={busy || !ready} accessibilityState={{ disabled: busy || !ready, busy: busy && action === 'approve' }} onPress={() => onReview(request, 'approve', evidence)} style={[styles.approve, (busy || !ready) && styles.disabled]}><Text style={styles.approveText}>{busy && action === 'approve' ? 'Approving…' : request.kind === 'verification' ? 'Grant artist check' : 'Approve claim & check'}</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={busy || !reasonReady} accessibilityState={{ disabled: busy || !reasonReady }} onPress={() => onReview(request, 'reject', { reason })} style={[styles.link, (busy || !reasonReady) && styles.disabled]}><Text style={styles.warning}>Reject request</Text></Pressable>
    </View>}
    {!!request.artistKey && <View style={styles.proof}>
      <Text style={styles.text}>Page safety is separate from verification. A hold hides this artist identity and revokes its check. Releasing a hold does not grant a check or automatically restore previously hidden posts.</Text>
      {(identityOnly ? ['hold', 'release'] : [held ? 'release' : 'hold']).map(safetyAction => <Pressable key={safetyAction} accessibilityRole="button" disabled={busy || (safetyAction === 'release' ? !releaseReady : !reasonReady)} accessibilityState={{ disabled: busy || (safetyAction === 'release' ? !releaseReady : !reasonReady) }} onPress={() => onReview(request, safetyAction, { reason, identityReviewConfirmed, officialAccountConfirmed, ownershipConfirmed, reviewedUrl })} style={[styles.link, (busy || (safetyAction === 'release' ? !releaseReady : !reasonReady)) && styles.disabled]}><Text style={styles.linkText}>{safetyAction === 'release' ? 'Release identity hold only' : 'Hold this artist page'}</Text></Pressable>)}
    </View>}
  </View>;
}

const styles = StyleSheet.create({ card: { padding: 18, gap: 12, marginBottom: 18, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, backgroundColor: colors.surface }, title: { color: colors.text, fontSize: 17, lineHeight: 25, fontWeight: '800' }, text: { color: colors.textDim, fontSize: 13, lineHeight: 21, flexShrink: 1 }, status: { color: colors.textFaint, fontSize: 11, fontWeight: '800' }, warning: { color: colors.danger, fontSize: 13, lineHeight: 21 }, code: { color: colors.amber, fontFamily: mono, fontSize: 20, fontWeight: '800' }, proof: { padding: 14, gap: 10, backgroundColor: colors.bg, borderRadius: radius.sm }, confirmation: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 }, check: { color: colors.amber, fontSize: 22 }, input: { borderColor: colors.line, borderWidth: 1, borderRadius: radius.sm, padding: 12, color: colors.text, fontSize: 14, backgroundColor: colors.bg }, reason: { minHeight: 90, textAlignVertical: 'top' }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, approve: { minHeight: 46, padding: 13, backgroundColor: colors.good, justifyContent: 'center', borderRadius: radius.sm }, approveText: { color: '#0C1A0F', fontWeight: '800', fontSize: 14 }, link: { minHeight: 44, justifyContent: 'center', paddingVertical: 8 }, linkText: { color: colors.amber, fontWeight: '800', fontSize: 13 }, disabled: { opacity: 0.4 } });
