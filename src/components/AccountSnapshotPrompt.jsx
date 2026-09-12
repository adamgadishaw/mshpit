import { StyleSheet, Text, View } from "react-native";
import { colors, displayFont, mono, radius } from "../theme";
import Button from "./Button";

// Public entity pages stay useful to visitors; their social features start
// only after the visitor intentionally chooses to sign in.
export default function AccountSnapshotPrompt({ title, body, onRequireAuth, style }) {
  return (
    <View style={[styles.card, style]}>
      <Text style={styles.kicker}>JOIN THE CROWD</Text>
      <Text style={styles.title} accessibilityRole="header">{title}</Text>
      <Text style={styles.body}>{body}</Text>
      <Button title="Sign in or create an account" onPress={() => onRequireAuth?.()} disabled={typeof onRequireAuth !== "function"} small />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10, padding: 18, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  kicker: { color: colors.amber, fontFamily: mono, fontSize: 10, fontWeight: "800", letterSpacing: 1.3 },
  title: { color: colors.text, fontFamily: displayFont, fontSize: 20, fontWeight: "800" },
  body: { color: colors.textDim, fontSize: 14, lineHeight: 21 },
});
