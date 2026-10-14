import { Pressable, StyleSheet, Text, View } from 'react-native';
import BrandMark from './BrandMark';
import { colors, font } from '../theme';
export default function NativeAppHeader({ onHome, onAccount, loggedIn }) {
  return <View style={styles.header}>
    <Pressable onPress={onHome} style={styles.brand} accessibilityRole="button" accessibilityLabel="Mshpit Discover">
      <BrandMark size={28} color={colors.amber} />
      <Text style={styles.wordmark}>MSHPIT</Text>
    </Pressable>
    <Pressable onPress={onAccount} style={styles.account} accessibilityRole="button" accessibilityLabel={loggedIn ? 'Open your profile' : 'Sign in'}>
      <Text style={styles.accountText}>{loggedIn ? 'Your profile' : 'Sign in'}</Text>
    </Pressable>
  </View>;
}
const styles = StyleSheet.create({
  header: { minHeight: 56, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.lineSoft, backgroundColor: colors.bg },
  brand: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8 },
  wordmark: { fontFamily: font, fontSize: 27, fontWeight: '800', letterSpacing: -1.4, color: colors.text },
  account: { minHeight: 44, minWidth: 64, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  accountText: { fontFamily: font, fontSize: 14, fontWeight: '600', color: colors.text },
});

