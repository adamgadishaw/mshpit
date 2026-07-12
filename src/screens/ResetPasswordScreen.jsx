import { useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView } from "react-native";
import { colors, mono, radius } from "../theme";
import { useStore } from "../store";
import Icon from "../components/Icon";
import SheetHeader from "../components/SheetHeader";

// Set a new password from an emailed reset link (?reset=TOKEN). On success the
// account is signed straight in and every other session is invalidated.
export default function ResetPasswordScreen({ token, onDone, onCancel }) {
  const { resetPassword } = useStore();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (password.length < 8) { setError("Use at least 8 characters."); return; }
    if (password !== confirm) { setError("The two passwords don't match."); return; }
    setBusy(true);
    const res = await resetPassword(token, password);
    setBusy(false);
    if (res.ok) onDone?.();
    else setError(res.error || "Couldn't reset. Request a new link.");
  };

  return (
    <View style={styles.wrap}>
      <SheetHeader title="Set a new password" onClose={onCancel} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.wordmark}>PIT</Text>
        <Text style={styles.tag}>Choose a new password for your account.</Text>
        <TextInput style={styles.input} placeholder="New password" placeholderTextColor={colors.textFaint} value={password} onChangeText={setPassword} secureTextEntry maxLength={100} />
        <TextInput style={styles.input} placeholder="Confirm new password" placeholderTextColor={colors.textFaint} value={confirm} onChangeText={setConfirm} secureTextEntry maxLength={100} onSubmitEditing={submit} />
        {!!error && <Text style={styles.error}>{error}</Text>}
        <Pressable style={[styles.primary, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy}>
          <Text style={styles.primaryTxt}>{busy ? "SAVING..." : "RESET PASSWORD"}</Text>
        </Pressable>
        <Pressable onPress={onCancel}><Text style={styles.switch}>Cancel</Text></Pressable>
        <View style={styles.note}>
          <Icon name="lock" size={15} color={colors.amber} />
          <Text style={styles.noteTxt}>For your security, this signs you out of every other device.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 48 },
  wordmark: { color: colors.text, fontSize: 34, fontWeight: "900", letterSpacing: 5, fontFamily: mono, marginTop: 8 },
  tag: { color: colors.textDim, fontSize: 14, marginTop: 4, marginBottom: 24 },
  input: { backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, color: colors.text, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, marginBottom: 10 },
  error: { color: colors.danger, fontSize: 13, marginBottom: 8 },
  primary: { backgroundColor: colors.amberStrong, borderRadius: radius.md, paddingVertical: 15, alignItems: "center", marginTop: 10 },
  primaryTxt: { color: "#1A1206", fontSize: 15, fontWeight: "800", letterSpacing: 1 },
  switch: { color: colors.amber, fontSize: 14, textAlign: "center", marginTop: 18 },
  note: { flexDirection: "row", gap: 10, backgroundColor: colors.bgElev, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 14, marginTop: 24 },
  noteTxt: { color: colors.textDim, fontSize: 12, lineHeight: 18, flex: 1 },
});
