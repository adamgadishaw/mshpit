// Confirmation step for an emailed unsubscribe link. The link itself only
// carries the token here; opting out happens on the tap below, so a mail
// scanner prefetching the URL cannot unsubscribe anyone by accident.
import { useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { colors, radius, space } from "../theme";
import { api } from "../lib/api";

export default function UnsubscribeScreen({ token, onDone }) {
  const [state, setState] = useState("asking");

  const submit = async (resubscribe) => {
    setState("working");
    try {
      await api("/api/unsubscribe", { method: "POST", body: { token, resubscribe }, context: "Updating email preferences" });
      setState(resubscribe ? "resubscribed" : "done");
    } catch {
      setState("failed");
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        {state === "asking" && (
          <>
            <Text style={styles.h}>Stop getting announcements?</Text>
            <Text style={styles.p}>
              You'll still get account email, like password resets. Those aren't announcements and can't be turned off.
            </Text>
            <Pressable style={[styles.btn, styles.btnPrimary]} onPress={() => submit(false)}>
              <Text style={styles.btnTxtPrimary}>Unsubscribe</Text>
            </Pressable>
            <Pressable style={styles.btn} onPress={onDone}>
              <Text style={styles.btnTxt}>Keep them coming</Text>
            </Pressable>
          </>
        )}

        {state === "working" && <Text style={styles.p}>Saving…</Text>}

        {state === "done" && (
          <>
            <Text style={styles.h}>Done, you're unsubscribed.</Text>
            <Text style={styles.p}>You won't get announcement email from Pit any more.</Text>
            <Pressable style={styles.btn} onPress={() => submit(true)}>
              <Text style={styles.btnTxt}>Actually, resubscribe me</Text>
            </Pressable>
            <Pressable style={[styles.btn, styles.btnPrimary]} onPress={onDone}>
              <Text style={styles.btnTxtPrimary}>Back to Pit</Text>
            </Pressable>
          </>
        )}

        {state === "resubscribed" && (
          <>
            <Text style={styles.h}>You're back on the list.</Text>
            <Pressable style={[styles.btn, styles.btnPrimary]} onPress={onDone}>
              <Text style={styles.btnTxtPrimary}>Back to Pit</Text>
            </Pressable>
          </>
        )}

        {state === "failed" && (
          <>
            <Text style={styles.h}>That didn't go through.</Text>
            <Text style={styles.p}>The link may have expired. Email preferences are in Settings once you're signed in.</Text>
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
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.md, backgroundColor: colors.bg },
  card: { width: "100%", maxWidth: 380, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: space.md },
  h: { color: colors.text, fontSize: 18, fontWeight: "800", marginBottom: space.sm },
  p: { color: colors.textDim, fontSize: 13, lineHeight: 19, marginBottom: space.md },
  btn: { paddingVertical: 12, borderRadius: 999, borderWidth: 1, borderColor: colors.line, alignItems: "center", marginTop: 8 },
  btnPrimary: { backgroundColor: colors.amberStrong, borderColor: colors.amberStrong },
  btnTxt: { color: colors.text, fontWeight: "700", fontSize: 13 },
  btnTxtPrimary: { color: "#1A1206", fontWeight: "800", fontSize: 13 },
});
