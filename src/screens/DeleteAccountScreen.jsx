import { useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import Button from "../components/Button";
import Icon from "../components/Icon";
import SheetHeader from "../components/SheetHeader";
import { useStore } from "../store";
import { colors, displayFont, radius } from "../theme";

function WarningLine({ children }) {
  return (
    <View style={styles.warningLine}>
      <View style={styles.dot} />
      <Text selectable style={styles.warningText}>{children}</Text>
    </View>
  );
}

export default function DeleteAccountScreen({ onClose, onDeleted }) {
  const { session, deleteAccount } = useStore();
  const [step, setStep] = useState("warning");
  const [password, setPassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!password || deleting) return;
    setDeleting(true);
    setError("");
    const result = await deleteAccount(password);
    if (result.ok) {
      onDeleted?.();
      return;
    }
    setError(result.error || "Your account couldn't be deleted. Try again.");
    setDeleting(false);
  };

  return (
    <View style={styles.wrap}>
      <SheetHeader title="Delete account" onBack={onClose} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroIcon}>
          <Icon name="trash" size={26} color={colors.danger} strokeWidth={2.3} />
        </View>
        <Text selectable style={styles.title}>
          {step === "warning" ? "Leave the venue for good?" : "One last soundcheck"}
        </Text>
        <Text selectable style={styles.lead}>
          {step === "warning"
            ? `Deleting @${session?.handle || "your account"} is permanent and can't be undone.`
            : "Enter your current password. We verify it on the server before anything is removed."}
        </Text>

        {step === "warning" ? (
          <>
            <View style={styles.warningCard}>
              <WarningLine>Your profile, concert reviews, comments, messages, follows, ratings, fan-club activity, and listening history are removed.</WarningLine>
              <WarningLine>Other people will no longer be able to find or contact this account.</WarningLine>
              <WarningLine>Uploaded images are detached from your account immediately. The storage cleanup worker and retention policy are not deployed yet, so object-storage or backup copies may remain until that work is completed.</WarningLine>
            </View>
            <Button title="CONTINUE" variant="danger" icon="trash" onPress={() => setStep("password")} />
            <Button title="KEEP MY ACCOUNT" variant="secondary" onPress={onClose} style={styles.secondary} />
          </>
        ) : (
          <>
            <Text style={styles.label}>CURRENT PASSWORD</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={(value) => { setPassword(value); setError(""); }}
              placeholder="Enter your password"
              placeholderTextColor={colors.textFaint}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="current-password"
              textContentType="password"
              maxLength={100}
              editable={!deleting}
              onSubmitEditing={submit}
              returnKeyType="done"
            />
            {!!error && <Text selectable style={styles.error}>{error}</Text>}
            <View style={styles.finalWarning}>
              <Icon name="shield" size={17} color={colors.danger} />
              <Text selectable style={styles.finalWarningText}>This action starts as soon as you press delete. There is no recovery period.</Text>
            </View>
            <Button
              title={deleting ? "DELETING ACCOUNT..." : "DELETE ACCOUNT PERMANENTLY"}
              variant="danger"
              icon="trash"
              disabled={!password || deleting}
              onPress={submit}
            />
            <Button
              title="BACK"
              variant="secondary"
              disabled={deleting}
              onPress={() => { setStep("warning"); setPassword(""); setError(""); }}
              style={styles.secondary}
            />
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 48, maxWidth: 600, width: "100%", alignSelf: "center" },
  heroIcon: { width: 56, height: 56, borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.danger, alignItems: "center", justifyContent: "center", marginTop: 10, marginBottom: 18 },
  title: { color: colors.text, fontFamily: displayFont, fontSize: 24, fontWeight: "900", letterSpacing: -0.4 },
  lead: { color: colors.textDim, fontSize: 15, lineHeight: 22, marginTop: 8, marginBottom: 20 },
  warningCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.line, padding: 16, gap: 14, marginBottom: 18 },
  warningLine: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.danger, marginTop: 7 },
  warningText: { flex: 1, color: colors.textDim, fontSize: 13.5, lineHeight: 20 },
  label: { color: colors.textFaint, fontSize: 11, fontWeight: "800", letterSpacing: 1.4, marginBottom: 8 },
  input: { backgroundColor: colors.surface, borderRadius: radius.sm, borderCurve: "continuous", borderWidth: 1, borderColor: colors.line, color: colors.text, paddingHorizontal: 14, paddingVertical: 14, fontSize: 15, marginBottom: 10 },
  error: { color: colors.danger, fontSize: 13, lineHeight: 18, marginBottom: 10 },
  finalWarning: { flexDirection: "row", gap: 10, backgroundColor: colors.bgElev, borderRadius: radius.sm, borderCurve: "continuous", borderWidth: 1, borderColor: colors.lineSoft, padding: 13, marginBottom: 16 },
  finalWarningText: { flex: 1, color: colors.textDim, fontSize: 12.5, lineHeight: 18 },
  secondary: { marginTop: 10 },
});
