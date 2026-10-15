import { View, Text, Pressable, StyleSheet } from "react-native";
import SheetHeader from "../components/SheetHeader";
import { colors } from "../theme";

export default function InvalidAccountLinkScreen({ onClose, onLogin, onRequestReset }) {
  return <View style={styles.wrap}>
    <SheetHeader title="Open a fresh account link" onClose={onClose} />
    <View style={styles.content}>
      <Text style={styles.text}>This account link is incomplete or contains conflicting instructions. Open the most recent email link. You can also log in to resend confirmation or request a new password reset.</Text>
      <Pressable onPress={onLogin}><Text style={styles.action}>Go to log in</Text></Pressable>
      <Pressable onPress={onRequestReset}><Text style={styles.action}>Request a new reset link</Text></Pressable>
    </View>
  </View>;
}
const styles = StyleSheet.create({ wrap: { flex: 1, backgroundColor: colors.bg }, content: { padding: 24, gap: 24 }, text: { color: colors.text, fontSize: 16, lineHeight: 24 }, action: { color: colors.amber, fontSize: 16, paddingVertical: 12 } });
