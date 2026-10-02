// Confirmation step for an emailed verification link. The link only carries the
// token here; confirming happens on the tap below, so a mail scanner prefetching
// the URL cannot mark an address verified on the owner's behalf.
import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { colors, radius, space } from "../theme";
import { useStore } from "../store";

export default function VerifyEmailScreen({ token, onConsumed, onDone, onLogin }) {
  const { confirmEmailVerification } = useStore();
  const [state, setState] = useState("asking");
  const requestRef = useRef(null);

  useEffect(() => () => requestRef.current?.abort(), []);

  const submit = async () => {
    if (requestRef.current) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setState("working");
    try {
      const result = await confirmEmailVerification(token, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (result?.verified) {
        onConsumed?.();
        setState(result.sessionUpdated ? "done" : "doneExternal");
      } else {
        setState(result?.outcome === "account_exists" ? "occupied" : result?.outcome === "authorization_changed" ? "changed" : "expired");
      }
    } catch {
      if (!controller.signal.aborted) setState("failed");
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        {state === "asking" && (
          <>
            <Text style={styles.h}>Confirm your email</Text>
            <Text style={styles.p}>
              Confirm only if you requested this email. For a new signup, this creates your account using the password you chose. You can browse without confirming, but posting, messaging, following, reacting, and public edits require it.
            </Text>
            <Pressable style={[styles.btn, styles.btnPrimary]} onPress={submit} accessibilityRole="button">
              <Text style={styles.btnTxtPrimary}>Confirm my email</Text>
            </Pressable>
            <Pressable style={styles.btn} onPress={onDone} accessibilityRole="button">
              <Text style={styles.btnTxt}>Not now</Text>
            </Pressable>
          </>
        )}

        {state === "working" && <Text style={styles.p}>Confirming...</Text>}

        {state === "done" && (
          <>
            <Text style={styles.h}>Your email is confirmed.</Text>
            <Text style={styles.p}>Your account is now email-confirmed. This private account check does not add the public verified badge.</Text>
            <Pressable style={[styles.btn, styles.btnPrimary]} onPress={onDone} accessibilityRole="button">
              <Text style={styles.btnTxtPrimary}>Back to Pit</Text>
            </Pressable>
          </>
        )}

        {state === "doneExternal" && (
          <>
            <Text style={styles.h}>That email is confirmed.</Text>
            <Text style={styles.p}>Log in to finish your profile, add your photos, and find your first show.</Text>
            <Pressable style={[styles.btn, styles.btnPrimary]} onPress={onLogin || onDone} accessibilityRole="button">
              <Text style={styles.btnTxtPrimary}>Continue to log in</Text>
            </Pressable>
          </>
        )}

        {state === "expired" && (
          <>
            <Text style={styles.h}>That link has expired.</Text>
            <Text style={styles.p}>
              This link has expired. Start signup again for a new link. If you already have an account, log in to resend verification.
            </Text>
            <Pressable style={[styles.btn, styles.btnPrimary]} onPress={onLogin || onDone} accessibilityRole="button">
              <Text style={styles.btnTxtPrimary}>Continue to log in or sign up</Text>
            </Pressable>
          </>
        )}

        {(state === "occupied" || state === "changed") && (
          <>
            <Text style={styles.h}>{state === "occupied" ? "An account already uses this email." : "Start this signup again."}</Text>
            <Text style={styles.p}>{state === "occupied"
              ? "Log in or reset your password to access your existing account. To add a second account, log in first and use Add account in Settings."
              : "The account or session used to request this additional account changed. Log in again, then use Add account in Settings."}</Text>
            <Pressable style={[styles.btn, styles.btnPrimary]} onPress={onLogin || onDone} accessibilityRole="button">
              <Text style={styles.btnTxtPrimary}>Continue to log in</Text>
            </Pressable>
          </>
        )}

        {state === "failed" && (
          <>
            <Text style={styles.h}>That didn't go through.</Text>
            <Text style={styles.p}>Your connection may have dropped after confirmation. It is safe to try this link again.</Text>
            <Pressable style={[styles.btn, styles.btnPrimary]} onPress={submit} accessibilityRole="button">
              <Text style={styles.btnTxtPrimary}>Try again</Text>
            </Pressable>
            <Pressable style={styles.btn} onPress={onDone} accessibilityRole="button">
              <Text style={styles.btnTxt}>Back to Pit</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: space(4), backgroundColor: colors.bg },
  card: { width: "100%", maxWidth: 380, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: space(4) },
  h: { color: colors.text, fontSize: 18, fontWeight: "800", marginBottom: space(3) },
  p: { color: colors.textDim, fontSize: 13, lineHeight: 19, marginBottom: space(4) },
  btn: { paddingVertical: 12, borderRadius: 999, borderWidth: 1, borderColor: colors.line, alignItems: "center", marginTop: 8 },
  btnPrimary: { backgroundColor: colors.amberStrong, borderColor: colors.amberStrong },
  btnTxt: { color: colors.text, fontWeight: "700", fontSize: 13 },
  btnTxtPrimary: { color: "#1A1206", fontWeight: "800", fontSize: 13 },
});
