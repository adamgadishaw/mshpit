// The nudge half of non-blocking email verification. The account already works;
// this only asks. It floats rather than sitting in the layout so it does not
// have to be threaded through both the wide and mobile branches of the app frame.
//
// Dismissal is per-session on purpose: it should come back next visit, but
// nagging someone who just closed it within the same session is how a prompt
// gets ignored permanently.
import { useState } from "react";
import { View, Text, StyleSheet, Pressable, Platform } from "react-native";
import { colors, radius, space } from "../theme";
import { api } from "../lib/api";
import Icon from "./Icon";

export default function VerifyEmailBanner({ email }) {
  const [state, setState] = useState("idle");
  if (state === "dismissed") return null;

  const resend = async () => {
    setState("sending");
    try {
      const r = await api("/api/verify-email/resend", { method: "POST", body: {}, context: "Resending the confirmation email" });
      setState(r?.sent ? "sent" : "unavailable");
    } catch {
      setState("unavailable");
    }
  };

  const copy = {
    idle: email ? `Confirm your email (${email}) so we can reach you about your account.` : "Confirm your email so we can reach you about your account.",
    sending: "Sending…",
    sent: "Sent. Check your inbox, and your spam folder.",
    unavailable: "Couldn't send that right now. Try again in a bit.",
  }[state];

  return (
    <View style={styles.wrap} accessibilityRole="alert">
      <Icon name="mail" size={15} color={colors.gold} />
      <Text style={styles.txt} numberOfLines={2}>{copy}</Text>
      {state === "idle" && (
        <Pressable style={styles.action} onPress={resend} accessibilityLabel="Resend the confirmation email">
          <Text style={styles.actionTxt}>Resend</Text>
        </Pressable>
      )}
      <Pressable style={styles.close} onPress={() => setState("dismissed")} accessibilityLabel="Dismiss">
        <Icon name="x" size={14} color={colors.textDim} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 16,
    right: 16,
    top: Platform.OS === "ios" ? 8 : 6,
    zIndex: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    alignSelf: "center",
    maxWidth: 640,
    marginHorizontal: "auto",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.gold,
    borderRadius: radius.md,
    paddingVertical: space(2),
    paddingHorizontal: space(3),
  },
  txt: { flex: 1, color: colors.text, fontSize: 12, lineHeight: 17 },
  action: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: colors.gold },
  actionTxt: { color: colors.gold, fontSize: 11, fontWeight: "700" },
  close: { padding: 4 },
});
