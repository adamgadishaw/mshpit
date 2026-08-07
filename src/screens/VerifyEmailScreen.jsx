// Confirmation step for an emailed verification link. The link only carries the
// token here; confirming happens on the tap below, so a mail scanner prefetching
// the URL cannot mark an address verified on the owner's behalf.
import { useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { colors, radius, space } from "../theme";
import { api } from "../lib/api";

export default function VerifyEmailScreen({ token, onDone }) {
  const [state, setState] = useState("asking");

  const submit = async () => {
    setState("working");
    try {
      const r = await api("/api/verify-email", { method: "POST", body: { token }, context: "Confirming your email" });
      // The endpoint answers the same shape for a live and a dead token so it
      // cannot be used to probe which are valid; `verified` is what separates them.
      setState(r?.verified ? "done" : "expired");
    } catch {
      setState("failed");
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        {state === "asking" && (
          <>
            <Text style={styles.h}>Confirm your email</Text>
            <Text style={styles.p}>
              Tap below to confirm this address belongs to you. Your account already works either way.
            </Text>
            <Pressable style={[styles.btn, styles.btnPrimary]} onPress={submit}>
              <Text style={styles.btnTxtPrimary}>Confirm my email</Text>
            </Pressable>
            <Pressable style={styles.btn} onPress={onDone}>
              <Text style={styles.btnTxt}>Not now</Text>
            </Pressable>
          </>
        )}

        {state === "working" && <Text style={styles.p}>Confirming…</Text>}

        {state === "done" && (
          <>
            <Text style={styles.h}>That's confirmed.</Text>
            <Text style={styles.p}>Thanks. We can reach you about your account now.</Text>
            <Pressable style={[styles.btn, styles.btnPrimary]} onPress={onDone}>
              <Text style={styles.btnTxtPrimary}>Back to Pit</Text>
            </Pressable>
          </>
        )}

        {state === "expired" && (
          <>
            <Text style={styles.h}>That link has expired.</Text>
            <Text style={styles.p}>
              Verification links last 24 hours. Sign in and you can send yourself a fresh one.
            </Text>
            <Pressable style={[styles.btn, styles.btnPrimary]} onPress={onDone}>
              <Text style={styles.btnTxtPrimary}>Back to Pit</Text>
            </Pressable>
          </>
        )}

        {state === "failed" && (
          <>
            <Text style={styles.h}>That didn't go through.</Text>
            <Text style={styles.p}>Sign in and you can send yourself a new link.</Text>
            <Pressable style={[styles.btn, styles.btnPrimary]} onPress={onDone}>
              <Text style={styles.btnTxtPrimary}>Back to Pit</Text>
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
