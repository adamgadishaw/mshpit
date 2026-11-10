import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius } from "../theme";
import { profileGuidance } from "../domain/profileGuidance.mjs";

export default function ProfileGuidance({ user, onEdit }) {
  const [dismissed, setDismissed] = useState(false);
  const guidance = profileGuidance(user);
  if (dismissed || !guidance.visible || !onEdit) return null;
  return <View style={styles.card}>
    <Text style={styles.title} accessibilityRole="header">Personalize your profile</Text>
    {guidance.music ? <Text style={styles.body}>Your music choices need a look. Choose 1–3 genres for better recommendations.</Text> : null}
    {guidance.optional.length ? <Text style={styles.body}>Optional: add {guidance.optional.join(", ")}. These details appear on your public profile.</Text> : null}
    <View style={styles.actions}>
      <Pressable onPress={onEdit} accessibilityRole="button" style={styles.button}><Text style={styles.link}>Review profile details</Text></Pressable>
      <Pressable onPress={() => setDismissed(true)} accessibilityRole="button" accessibilityLabel="Dismiss profile suggestions" style={styles.button}><Text style={styles.muted}>Not now</Text></Pressable>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 16, marginTop: 16, padding: 14, gap: 7, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, backgroundColor: colors.bgElev },
  title: { color: colors.text, fontSize: 14, fontWeight: "700" },
  body: { color: colors.textDim, fontSize: 13, lineHeight: 19 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  button: { minHeight: 44, justifyContent: "center" },
  link: { color: colors.amber, fontSize: 13, fontWeight: "700" },
  muted: { color: colors.textDim, fontSize: 13 },
});
