import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { colors, mono, radius } from "../theme";
import { useStore } from "../store";
import Icon from "../components/Icon";
import SheetHeader from "../components/SheetHeader";
import { isPassword } from "../domain/validation.mjs";
import CredentialForm, { CredentialInput, CredentialLabel, CredentialSubmit } from "../components/credential-form";

const readableError = (error, fallback) => String(typeof error === "string" ? error : error?.userMessage || error?.message || fallback).slice(0, 280);

// Set a new password from an emailed reset link (?reset=TOKEN). On success the
// account is signed straight in and every other session is invalidated.
export default function ResetPasswordScreen({ token, onDone, onCancel, onLogin, onRequestReset }) {
  const { resetPassword, session } = useStore();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [recovery, setRecovery] = useState(null);
  const [busy, setBusy] = useState(false);
  const attempt = useRef(null);
  const confirmationInput = useRef(null);
  useEffect(() => () => { attempt.current?.abort(); }, []);

  const submit = async () => {
    if (busy || attempt.current) return;
    if (!isPassword(password)) { setError("Use 8 or more characters, including a letter and a number."); return; }
    if (password !== confirm) { setError("The two passwords don't match."); return; }
    setBusy(true);
    setError("");
    setRecovery(null);
    const controller = new AbortController();
    attempt.current = controller;
    try {
      const res = await resetPassword(token, password, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (res?.ok) onDone?.();
      else { setError(readableError(res?.error, "Couldn't reset. Request a new link.")); setRecovery(res?.outcome || "rejected"); }
    } catch {
      if (controller.signal.aborted) return;
      setError("Your password may already have changed. Try logging in with the new password you just entered.");
      setRecovery("uncertain");
    } finally {
      if (attempt.current === controller) attempt.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <SheetHeader title="Set a new password" onClose={onCancel} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.wordmark}>MSHPIT</Text>
        <Text style={styles.tag}>Choose a new password for the account that received this email link. Completing the reset signs that account in.</Text>
        {session ? <Text style={styles.tag} accessibilityRole="alert">You are currently signed in as @{session.handle}. This link may be for a different account. Resetting will switch to the account that received the email.</Text> : null}
        <CredentialForm busy={busy} id="pit-reset-password" onSubmit={submit} disabled={busy}>
        <CredentialLabel htmlFor="new-password" style={styles.label}>New password</CredentialLabel>
        <CredentialInput
          name="new-password"
          style={styles.input}
          placeholder="New password"
          placeholderTextColor={colors.textFaint}
          value={password}
          onChangeText={(value) => { setPassword(value); setError(""); }}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="next"
          onSubmitEditing={() => confirmationInput.current?.focus()}
          maxLength={100}
          editable={!busy}
          accessibilityLabel="New password"
          accessibilityHint="Use at least eight characters"
          accessibilityState={{ disabled: busy }}
        />
        <CredentialLabel htmlFor="confirm-password" style={styles.label}>Confirm new password</CredentialLabel>
        <CredentialInput
          ref={confirmationInput}
          name="confirm-password"
          style={styles.input}
          placeholder="Confirm new password"
          placeholderTextColor={colors.textFaint}
          value={confirm}
          onChangeText={(value) => { setConfirm(value); setError(""); }}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="done"
          maxLength={100}
          editable={!busy}
          accessibilityLabel="Confirm new password"
          accessibilityState={{ disabled: busy }}
        />
        {!!error && <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">{error}</Text>}
        <CredentialSubmit style={[styles.primary, busy && styles.disabled]} onPress={submit} disabled={busy} accessibilityRole="button" accessibilityState={{ disabled: busy, busy }}>
          <Text style={styles.primaryTxt}>{busy ? "SAVING..." : session ? "Reset linked account and sign in" : "RESET PASSWORD"}</Text>
        </CredentialSubmit>
        </CredentialForm>
        {recovery ? <>
          <Pressable style={styles.switchButton} onPress={onLogin} disabled={busy} accessibilityRole="button"><Text style={styles.switch}>{recovery === "uncertain" ? "Log in with the new password" : "Go to log in"}</Text></Pressable>
          <Pressable style={styles.switchButton} onPress={onRequestReset} disabled={busy} accessibilityRole="button"><Text style={styles.switch}>Request a new reset link</Text></Pressable>
        </> : null}
        <Pressable style={styles.switchButton} onPress={onCancel} disabled={busy} accessibilityRole="button" accessibilityState={{ disabled: busy }}><Text style={styles.switch}>Cancel</Text></Pressable>
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
  label: { color: colors.text, fontSize: 14, fontWeight: "700", marginBottom: 6 },
  input: { backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, color: colors.text, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, marginBottom: 10 },
  error: { color: colors.danger, fontSize: 13, marginBottom: 8 },
  primary: { backgroundColor: colors.amberStrong, borderRadius: radius.md, paddingVertical: 15, alignItems: "center", marginTop: 10 },
  disabled: { opacity: 0.6 },
  primaryTxt: { color: "#1A1206", fontSize: 15, fontWeight: "800", letterSpacing: 1 },
  switchButton: { minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: 8 },
  switch: { color: colors.amber, fontSize: 14, textAlign: "center" },
  note: { flexDirection: "row", gap: 10, backgroundColor: colors.bgElev, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 14, marginTop: 24 },
  noteTxt: { color: colors.textDim, fontSize: 12, lineHeight: 18, flex: 1 },
});
