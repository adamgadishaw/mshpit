import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, radius, space, focusRing, displayFont, font } from '../../theme';

export function VenueAction({ label, accessibilityLabel = label, onPress, disabled = false }) {
  return <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ disabled }}
    style={({ focused, pressed }) => [styles.button, focused && focusRing, (disabled || pressed) && { opacity: .5 }]}><Text style={styles.link}>{label}</Text></Pressable>;
}
export function VenueResourceState({ model }) {
  return <>
    {['loading', 'refreshing'].includes(model.resource.status) && <Text style={styles.body}>Loading venue community…</Text>}
    {model.resource.status === 'error' && <View accessibilityRole="alert"><Text style={styles.body}>{model.resource.error?.userMessage || 'Venue community could not be loaded.'}</Text><VenueAction label="Retry venue community" onPress={model.load} /></View>}
    {!!model.error && <Text accessibilityRole="alert" selectable style={styles.body}>{model.error.userMessage || 'Your changes could not be saved. Please try again.'}</Text>}
  </>;
}

export const styles = StyleSheet.create({
  panel: { gap: space(3), borderTopWidth: 1, borderColor: colors.lineSoft, paddingVertical: space(4) },
  title: { color: colors.text, fontFamily: displayFont, fontSize: 22, fontWeight: '800' }, badge: { color: colors.amber, fontFamily: font, fontWeight: '800', fontSize: 14 },
  body: { color: colors.textDim, fontFamily: font, fontSize: 14, lineHeight: 22 }, score: { color: colors.text, fontFamily: displayFont, fontSize: 24, fontWeight: '700' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 }, star: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  button: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8, borderRadius: radius.sm }, link: { color: colors.amber, fontWeight: '700', fontSize: 14 },
  form: { gap: space(2) }, input: { color: colors.text, backgroundColor: colors.bg, padding: space(3), minHeight: 48, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm },
  review: { borderTopWidth: 1, borderColor: colors.lineSoft, paddingVertical: space(2), gap: 4 },
});
