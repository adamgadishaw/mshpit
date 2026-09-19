import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, radius, mono } from "../theme";
import { verificationExpiry } from "../domain/artistVerificationProof.mjs";

export default function ArtistVerificationFields({ method, onMethod, handle, onHandle, challenge, challengeState, storyUrl, onStoryUrl, onChallenge, disabled, canGenerate, generating }) {
  return <View style={styles.section}>
    <Text style={styles.title}>Choose how to verify your artist identity</Text>
    <View accessibilityRole="radiogroup" accessibilityLabel="Artist verification method" style={styles.choices}>
      {[['instagram_story', 'Instagram Story code'], ['manual', 'Official website or other evidence']].map(([value, label]) => <Pressable key={value} accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ checked: method === value, disabled }} {...(Platform.OS === 'web' ? { 'aria-checked': method === value } : {})} disabled={disabled} onPress={() => onMethod(value)} style={[styles.choice, method === value && styles.selected]}><Text style={styles.choiceText}>{label}</Text></Pressable>)}
    </View>
    {method === 'instagram_story' ? <>
      <Text style={styles.body}>1. Use the established official Instagram account for this artist. A new look-alike account does not prove ownership. We never need your Instagram password.</Text>
      <TextInput style={styles.input} accessibilityLabel="Official artist Instagram handle" value={handle} onChangeText={onHandle} placeholder="@officialartist" placeholderTextColor={colors.textFaint} maxLength={31} autoCapitalize="none" autoCorrect={false} editable={!disabled} />
      <Pressable accessibilityRole="button" disabled={!canGenerate || generating} accessibilityState={{ disabled: !canGenerate || generating, busy: generating }} onPress={onChallenge} style={[styles.button, (!canGenerate || generating) && styles.disabled]}><Text style={styles.buttonText}>{generating ? 'Creating code…' : ['active', 'submitted'].includes(challengeState) ? 'Current Story code ready' : challenge ? 'Generate a fresh Story code' : 'Create my Story code'}</Text></Pressable>
      {challengeState === 'expired' && <Text style={styles.warning} accessibilityRole="alert">This code expired. Generate a fresh code and post a new Story before submitting again.</Text>}
      {challengeState === 'mismatch' && <Text style={styles.warning}>That code belongs to a different artist name or Instagram handle. Generate a new code for these details.</Text>}
      {['active', 'submitted'].includes(challengeState) && <View style={styles.codeBox}>
        <Text style={styles.body}>2. Post this artist name and unique code together in a Story from @{challenge.instagramHandle}. This is a one-time verification challenge, not a password.</Text>
        <Text selectable style={styles.artist}>{challenge.artistName} on Mshpit</Text>
        <Text selectable style={styles.code} accessibilityLabel="Your artist verification code">{challenge.code}</Text>
        <Text selectable style={styles.body}>Code expires {new Date(verificationExpiry(challenge.expiresAt)).toLocaleString()}. Keep the Story live until review; if the code or Story expires first, create a fresh challenge.</Text>
      </View>}
      <Text style={styles.body}>3. Paste the exact Story link, not your profile link. The owner must view the live Story and matching code on the established official account. A screenshot or URL alone is not proof, and this does not automatically grant a check.</Text>
      <TextInput style={styles.input} accessibilityLabel="Instagram Story URL" value={storyUrl} onChangeText={onStoryUrl} placeholder="https://www.instagram.com/stories/artist/123.../" placeholderTextColor={colors.textFaint} keyboardType="url" autoCapitalize="none" autoCorrect={false} editable={!disabled} maxLength={512} />
    </> : <Text style={styles.body}>Share an established official website, social account, label, or management contact below. Mshpit manually checks that it belongs to this artist and that you control or represent it; name similarity alone is not proof.</Text>}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 12, marginTop: 24 }, title: { color: colors.text, fontWeight: '800', fontSize: 17, lineHeight: 24 },
  choices: { gap: 10 }, choice: { minHeight: 48, padding: 13, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, backgroundColor: colors.surface }, selected: { borderColor: colors.amber }, choiceText: { color: colors.text, fontWeight: '700', fontSize: 14 },
  body: { color: colors.textDim, fontSize: 13, lineHeight: 21 }, input: { padding: 13, color: colors.text, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, borderRadius: radius.sm, fontSize: 14 },
  button: { minHeight: 46, padding: 12, borderWidth: 1, borderColor: colors.amber, borderRadius: radius.sm, alignItems: 'center' }, buttonText: { color: colors.amber, fontSize: 14, fontWeight: '800' }, disabled: { opacity: 0.4 }, warning: { color: colors.danger, fontSize: 13, lineHeight: 20 },
  codeBox: { gap: 12, padding: 16, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.amber }, artist: { color: colors.text, fontSize: 17, fontWeight: '700' }, code: { color: colors.amber, fontFamily: mono, fontSize: 22, fontWeight: '800' },
});
