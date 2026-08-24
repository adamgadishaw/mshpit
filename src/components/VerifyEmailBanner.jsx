// Email confirmation is a real publishing boundary, not a disposable tip.
// The compact reminder therefore stays visible while the account is
// unconfirmed. When someone reaches for a protected action, the same component
// expands into an action-specific gate with a resend control and a safe path
// back to browsing.
import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Platform } from "react-native";
import { colors, focusRing, radius, shadow, space } from "../theme";
import { verificationPromptCopy } from "../domain/emailVerificationUx.mjs";
import Icon from "./Icon";

export default function VerifyEmailBanner({ email, topOffset, onResend, blockedAction = null, onCloseGate }) {
  const [state, setState] = useState("idle");
  const requestRef = useRef(null);

  useEffect(() => () => requestRef.current?.abort(), []);
  useEffect(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    setState("idle");
  }, [email]);

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

  const statusCopy = {
    idle: "Check your inbox for the confirmation link, or request a fresh one.",
    sending: "Sending a fresh link...",
    sent: "Fresh link sent. Check your inbox and spam folder.",
    recent: "A link was sent recently. Check your inbox and spam folder.",
    confirmed: "Confirmed. Refreshing your account...",
    unavailable: "We couldn't send a new link just now. Try again in a bit.",
  }[state];
  const canResend = state === "idle" || state === "unavailable";

  if (blockedAction) {
    const prompt = verificationPromptCopy(blockedAction);
    return (
      <View
        style={styles.gateBackdrop}
        accessibilityViewIsModal
        importantForAccessibility="yes"
      >
        <View style={styles.gateCard} accessibilityRole="alert">
          <View style={styles.gateMark}>
            <Icon name="mail" size={24} color={colors.gold} strokeWidth={2.2} />
          </View>
          <Text style={styles.eyebrow}>ONE QUICK CHECK</Text>
          <Text style={styles.gateTitle} accessibilityRole="header">{prompt.title}</Text>
          <Text style={styles.gateBody}>{prompt.body}</Text>
          <View style={styles.addressRow}>
            <Icon name="you" size={14} color={colors.textDim} />
            <Text style={styles.address} numberOfLines={1}>{email || "Your account email"}</Text>
          </View>
          <Text style={styles.status} accessibilityLiveRegion="polite">{statusCopy}</Text>
          <Pressable
            style={({ focused, pressed }) => [styles.primary, focused && focusRing, pressed && styles.pressed, !canResend && styles.disabled]}
            onPress={resend}
            disabled={!canResend}
            accessibilityRole="button"
            accessibilityLabel={state === "unavailable" ? "Try sending a new confirmation email" : "Send a new confirmation email"}
            accessibilityState={{ disabled: !canResend, busy: state === "sending" }}
          >
            <Text style={styles.primaryText}>
              {state === "sending" ? "SENDING..." : state === "sent" || state === "recent" ? "CHECK YOUR INBOX" : "SEND A NEW LINK"}
            </Text>
          </Pressable>
          <Pressable
            style={({ focused, pressed }) => [styles.secondary, focused && focusRing, pressed && styles.pressed]}
            onPress={onCloseGate}
            accessibilityRole="button"
            accessibilityLabel="Keep browsing without making this change"
          >
            <Text style={styles.secondaryText}>Keep browsing</Text>
          </Pressable>
          <Text style={styles.footnote}>Browsing, account export, privacy settings, and account deletion remain available.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.banner, Number.isFinite(topOffset) && { top: topOffset }]} accessibilityRole="alert">
      <View style={styles.bannerMark}><Icon name="mail" size={15} color={colors.gold} /></View>
      <View style={styles.bannerCopy}>
        <Text style={styles.bannerTitle}>Confirm your email to join in</Text>
        <Text style={styles.bannerText} numberOfLines={2}>
          You can explore now. Confirm before you post, message, follow, react, or edit public info.
        </Text>
      </View>
      <Pressable
        style={({ focused, pressed }) => [styles.bannerAction, focused && focusRing, pressed && styles.pressed, !canResend && styles.disabled]}
        onPress={resend}
        disabled={!canResend}
        accessibilityRole="button"
        accessibilityLabel={state === "unavailable" ? "Try sending a new confirmation email" : "Send a new confirmation email"}
        accessibilityState={{ disabled: !canResend, busy: state === "sending" }}
      >
        <Text style={styles.bannerActionText}>
          {state === "sending" ? "Sending..." : state === "sent" || state === "recent" ? "Email sent" : state === "confirmed" ? "Confirmed" : "Resend"}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    left: 16,
    right: 16,
    top: Platform.OS === "ios" ? 8 : 6,
    zIndex: 440,
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    alignSelf: "center",
    maxWidth: 680,
    marginHorizontal: "auto",
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.gold,
    borderRadius: radius.md,
    paddingVertical: space(2),
    paddingHorizontal: space(2.5),
    ...shadow.control,
  },
  bannerMark: { width: 30, height: 30, alignItems: "center", justifyContent: "center", borderRadius: 15, backgroundColor: `${colors.gold}14` },
  bannerCopy: { flex: 1, minWidth: 0 },
  bannerTitle: { color: colors.text, fontSize: 12.5, lineHeight: 16, fontWeight: "900" },
  bannerText: { color: colors.textDim, fontSize: 11, lineHeight: 15, marginTop: 1 },
  bannerAction: { minHeight: 40, justifyContent: "center", paddingHorizontal: 12, borderRadius: 999, backgroundColor: colors.amberStrong },
  bannerActionText: { color: "#1A1206", fontSize: 11, fontWeight: "900" },
  gateBackdrop: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 700,
    alignItems: "center",
    justifyContent: "center",
    padding: space(4),
    backgroundColor: "rgba(0,0,0,0.72)",
  },
  gateCard: {
    width: "100%",
    maxWidth: 440,
    alignItems: "center",
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.gold,
    borderRadius: radius.lg,
    padding: space(5),
    ...shadow.card,
  },
  gateMark: { width: 54, height: 54, alignItems: "center", justifyContent: "center", borderRadius: 27, backgroundColor: `${colors.gold}14`, borderWidth: 1, borderColor: `${colors.gold}55`, marginBottom: space(3) },
  eyebrow: { color: colors.gold, fontSize: 10, lineHeight: 14, fontWeight: "900", letterSpacing: 1.5, marginBottom: space(1) },
  gateTitle: { color: colors.text, fontSize: 23, lineHeight: 28, fontWeight: "900", textAlign: "center" },
  gateBody: { color: colors.textDim, fontSize: 14, lineHeight: 21, textAlign: "center", marginTop: space(2) },
  addressRow: { maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: 7, marginTop: space(4), paddingHorizontal: space(3), paddingVertical: space(2), borderRadius: radius.pill, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line },
  address: { flexShrink: 1, color: colors.text, fontSize: 12, fontWeight: "700" },
  status: { minHeight: 36, color: colors.textDim, fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: space(2) },
  primary: { width: "100%", minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: colors.amberStrong, marginTop: space(2) },
  primaryText: { color: "#1A1206", fontSize: 13, fontWeight: "900", letterSpacing: 0.5 },
  secondary: { minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: space(4), marginTop: space(1) },
  secondaryText: { color: colors.text, fontSize: 13, fontWeight: "800" },
  footnote: { color: colors.textFaint, fontSize: 10.5, lineHeight: 15, textAlign: "center", marginTop: space(2) },
  disabled: { opacity: 0.62 },
  pressed: { opacity: 0.78 },
});
