// The nudge half of non-blocking email verification. The account already works;
// this only asks. It floats rather than sitting in the layout so it does not
// have to be threaded through both the wide and mobile branches of the app frame.
//
// Dismissal is per-session on purpose: it should come back next visit, but
// nagging someone who just closed it within the same session is how a prompt
// gets ignored permanently.
import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Platform } from "react-native";
import { colors, radius, space } from "../theme";
import Icon from "./Icon";

export default function VerifyEmailBanner({ email, topOffset, onResend }) {
  const [state, setState] = useState("idle");
  const requestRef = useRef(null);
  useEffect(() => () => requestRef.current?.abort(), []);
  if (state === "dismissed") return null;

  const resend = async () => {
    if (state === "sending") return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setState("sending");
    try {
      const result = await onResend?.({ signal: controller.signal });
      if (!controller.signal.aborted) setState(result?.state || "unavailable");
    } catch {
      if (!controller.signal.aborted) setState("unavailable");
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  };

  const copy = {
    idle: email ? `Confirm your email (${email}) so we can reach you about your account.` : "Confirm your email so we can reach you about your account.",
    sending: "Requesting...",
    sent: "Requested. Check your inbox and spam folder.",
    recent: "A confirmation was recently requested. Check your inbox and spam folder.",
    confirmed: "Your email is already confirmed. Refreshing your account status...",
    unavailable: "Couldn't send that right now. Try again in a bit.",
  }[state];

  return (
    <View style={[styles.wrap, Number.isFinite(topOffset) && { top: topOffset }]} accessibilityRole="alert">
      <Icon name="mail" size={15} color={colors.gold} />
      <Text style={styles.txt} numberOfLines={2}>{copy}</Text>
      {(state === "idle" || state === "unavailable") && (
        <Pressable style={styles.action} hitSlop={4} onPress={resend} accessibilityRole="button" accessibilityLabel={state === "idle" ? "Resend the confirmation email" : "Try resending the confirmation email"}>
          <Text style={styles.actionTxt}>{state === "idle" ? "Resend" : "Try again"}</Text>
        </Pressable>
      )}
      <Pressable style={styles.close} hitSlop={4} onPress={() => setState("dismissed")} accessibilityRole="button" accessibilityLabel="Dismiss email confirmation reminder">
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
  action: { minHeight: 36, justifyContent: "center", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: colors.gold },
  actionTxt: { color: colors.gold, fontSize: 11, fontWeight: "700" },
  close: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
});
