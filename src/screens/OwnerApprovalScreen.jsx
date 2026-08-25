import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import Icon from "../components/Icon";
import SheetHeader from "../components/SheetHeader";
import { ownerApprovalPresentation, ownerApprovalRemaining } from "../domain/ownerApproval.mjs";
import { decideOwnerApproval, reviewOwnerApproval } from "../features/ownerApprovals/services/ownerApprovalApi.mjs";
import { colors, mono, radius, space } from "../theme";

const reviewFailureCopy = (error) => {
  if (error?.status === 401) return "Sign in as the locked Mshpit Owner to review this request.";
  if (error?.status === 403) return "This account is not the locked Mshpit Owner.";
  if (error?.status === 410) return "This approval link has expired, was replaced, or was already used.";
  return error?.message || "The sealed request could not be loaded. Check your connection and try again.";
};

const decisionFailureCopy = (error) => {
  if (error?.status === 401) return error?.message || "That password does not match the locked Owner account.";
  if (error?.status === 403) return "This session is no longer the locked Mshpit Owner. Sign in again before retrying.";
  if (error?.status === 410) return "This request expired, was replaced, or was already decided. Nothing else was applied.";
  return error?.message || "The decision could not be recorded. The request is unchanged and it is safe to retry.";
};

function DecisionButton({ label, icon, tone, disabled, busy, onPress }) {
  const approve = tone === "approve";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.decisionButton,
        approve ? styles.approveButton : styles.rejectButton,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={approve ? "#1A1206" : colors.danger} /> : <Icon name={icon} size={16} color={approve ? "#1A1206" : colors.danger} />}
      <Text style={[styles.decisionText, approve ? styles.approveText : styles.rejectText]}>{busy ? "RECORDING..." : label}</Text>
    </Pressable>
  );
}

export default function OwnerApprovalScreen({ token, session, onConsumed, onDone, onSignOut }) {
  const [phase, setPhase] = useState("loading");
  const [review, setReview] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [password, setPassword] = useState("");
  const [busyDecision, setBusyDecision] = useState(null);
  const [result, setResult] = useState(null);
  const [retryKey, setRetryKey] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const requestRef = useRef(null);

  const presentation = useMemo(() => ownerApprovalPresentation(review), [review]);
  const remaining = ownerApprovalRemaining(presentation?.expiresAt, clock);

  useEffect(() => {
    if (!token || session?.owner !== true) return undefined;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setPhase("loading");
    setLoadError("");
    setReview(null);
    reviewOwnerApproval(token, { signal: controller.signal })
      .then((payload) => {
        if (controller.signal.aborted) return;
        if (!ownerApprovalPresentation(payload?.review)) throw new Error("This request could not be safely displayed.");
        setReview(payload.review);
        setPhase("review");
      })
      .catch((error) => {
        if (controller.signal.aborted || error?.name === "AbortError") return;
        setLoadError(reviewFailureCopy(error));
        setPhase("error");
      })
      .finally(() => {
        if (requestRef.current === controller) requestRef.current = null;
      });
    return () => controller.abort();
  }, [token, session?.id, session?.owner, retryKey]);

  useEffect(() => {
    if (phase !== "review") return undefined;
    const timer = setInterval(() => setClock(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [phase]);

  const decide = async (decision) => {
    if (busyDecision || !password || remaining.expired) return;
    setBusyDecision(decision);
    setActionError("");
    try {
      const response = await decideOwnerApproval(token, { decision, password });
      if (!response?.ok || response.decision !== decision || !response.receipt?.id) {
        throw new Error("The server did not return a complete Owner receipt.");
      }
      setResult(response);
      setPhase("done");
      onConsumed?.();
    } catch (error) {
      setActionError(decisionFailureCopy(error));
    } finally {
      setPassword("");
      setBusyDecision(null);
    }
  };

  if (session?.owner !== true) {
    return (
      <View style={styles.wrap}>
        <SheetHeader title="Owner review" onClose={onDone} />
        <View style={styles.centered}>
          <View style={styles.heroIcon}><Icon name="lock" size={28} color={colors.amber} /></View>
          <Text accessibilityRole="header" style={styles.title}>Owner sign-in required</Text>
          <Text style={styles.body}>
            {session?.id
              ? `You are signed in as @${session.handle || session.name || "another account"}. Sign out, then use the locked Mshpit Owner account. The request will stay sealed in this tab.`
              : "Sign in with the locked Mshpit Owner account to open this sealed request."}
          </Text>
          {session?.id && onSignOut ? (
            <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={onSignOut}>
              <Text style={styles.secondaryText}>SIGN OUT AND SWITCH ACCOUNT</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <SheetHeader title="Owner review" onClose={busyDecision ? undefined : onDone} leadDisabled={!!busyDecision} leadHint="Closes without deciding" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {phase === "loading" ? (
          <View style={styles.centered} accessibilityLiveRegion="polite">
            <ActivityIndicator size="small" color={colors.amber} />
            <Text style={styles.body}>Opening the sealed request...</Text>
          </View>
        ) : null}

        {phase === "error" ? (
          <View style={styles.centered}>
            <View style={styles.heroIcon}><Icon name="x" size={26} color={colors.danger} /></View>
            <Text accessibilityRole="header" style={styles.title}>Request unavailable</Text>
            <Text accessibilityRole="alert" style={[styles.body, { color: colors.danger }]}>{loadError}</Text>
            <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={() => setRetryKey((value) => value + 1)}>
              <Text style={styles.secondaryText}>TRY AGAIN</Text>
            </Pressable>
          </View>
        ) : null}

        {phase === "review" && presentation ? (
          <>
            <View style={styles.sealRow}>
              <View style={styles.heroIcon}><Icon name="shield" size={26} color={colors.amber} /></View>
              <View style={styles.sealCopy}>
                <Text style={styles.eyebrow}>{presentation.eyebrow}</Text>
                <Text accessibilityRole="header" style={styles.title}>{presentation.title}</Text>
              </View>
            </View>
            <Text style={styles.body}>{presentation.explanation}</Text>

            <View style={styles.detailCard}>
              {presentation.details.map((detail) => (
                <View key={detail.label} style={styles.detailRow}>
                  <Text style={styles.detailLabel}>{detail.label}</Text>
                  <Text selectable style={styles.detailValue}>{detail.value}</Text>
                </View>
              ))}
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Request</Text>
                <Text selectable style={styles.detailValue}>{presentation.id}</Text>
              </View>
            </View>

            <View style={[styles.notice, remaining.expired && styles.noticeDanger]}>
              <Icon name={remaining.expired ? "x" : "clock"} size={16} color={remaining.expired ? colors.danger : colors.gold} />
              <Text style={[styles.noticeText, remaining.expired && { color: colors.danger }]}>
                {remaining.expired
                  ? "This request has expired. Close it and have an administrator create a fresh request."
                  : remaining.minutes == null
                    ? "The server will verify that this request is still current before recording a decision."
                    : `This one-time request expires in about ${remaining.minutes} minute${remaining.minutes === 1 ? "" : "s"}. Opening it did not apply anything.`}
              </Text>
            </View>

            <Text style={styles.passwordLabel}>OWNER PASSWORD</Text>
            <TextInput
              accessibilityLabel="Owner password"
              accessibilityHint="Required for both approval and rejection"
              accessibilityState={{ disabled: !!busyDecision || remaining.expired }}
              autoCapitalize="none"
              autoComplete="current-password"
              autoCorrect={false}
              editable={!busyDecision && !remaining.expired}
              maxLength={100}
              onChangeText={(value) => { setPassword(value); setActionError(""); }}
              onSubmitEditing={() => decide("approved")}
              placeholder="Re-enter the current Owner password"
              placeholderTextColor={colors.textFaint}
              returnKeyType="done"
              secureTextEntry
              style={styles.passwordInput}
              textContentType="password"
              value={password}
            />
            <Text style={styles.passwordHint}>The password is sent only for this decision and is never placed in the link or receipt.</Text>
            {actionError ? <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.error}>{actionError}</Text> : null}

            <View style={styles.decisionRow}>
              <DecisionButton label="REJECT REQUEST" icon="x" tone="reject" disabled={!password || !!busyDecision || remaining.expired} busy={busyDecision === "rejected"} onPress={() => decide("rejected")} />
              <DecisionButton label={presentation.approveLabel} icon="check" tone="approve" disabled={!password || !!busyDecision || remaining.expired} busy={busyDecision === "approved"} onPress={() => decide("approved")} />
            </View>
          </>
        ) : null}

        {phase === "done" && result ? (
          <View style={styles.centered}>
            <View style={[styles.heroIcon, result.decision === "approved" ? styles.heroApproved : styles.heroRejected]}>
              <Icon name={result.decision === "approved" ? "check" : "x"} size={28} color={result.decision === "approved" ? colors.good : colors.danger} />
            </View>
            <Text accessibilityRole="header" style={styles.title}>{result.decision === "approved" ? "Approved and recorded" : "Rejected and recorded"}</Text>
            <Text style={styles.body}>
              {result.decision === "approved"
                ? "The approved action and its immutable Owner receipt were recorded together."
                : "No requested authority was granted. The rejection receipt was recorded."}
            </Text>
            <View style={styles.receiptCard}>
              <Text style={styles.detailLabel}>RECEIPT</Text>
              <Text selectable style={styles.receiptValue}>{result.receipt.id}</Text>
              <Text style={styles.detailLabel}>HASH-CHAIN STAMP</Text>
              <Text selectable style={styles.receiptStamp}>{result.receipt.stamp}</Text>
              <Text style={styles.passwordHint}>{result.emailSent ? "A copy was sent to founder@mshpit.com." : "The receipt is saved, but the founder email copy could not be delivered."}</Text>
            </View>
            <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={onDone}>
              <Text style={styles.primaryText}>BACK TO MSHPIT</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  content: { width: "100%", maxWidth: 700, alignSelf: "center", padding: space(4), paddingBottom: space(10) },
  centered: { minHeight: 300, alignItems: "center", justifyContent: "center", gap: space(3), padding: space(4) },
  heroIcon: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.amber + "66", backgroundColor: colors.amber + "12" },
  heroApproved: { borderColor: colors.good + "66", backgroundColor: colors.good + "12" },
  heroRejected: { borderColor: colors.danger + "66", backgroundColor: colors.danger + "12" },
  sealRow: { flexDirection: "row", alignItems: "center", gap: space(3), marginBottom: space(3) },
  sealCopy: { flex: 1, minWidth: 0, gap: 3 },
  eyebrow: { color: colors.amber, fontFamily: mono, fontSize: 10, fontWeight: "900", letterSpacing: 1.4 },
  title: { color: colors.text, fontSize: 24, lineHeight: 30, fontWeight: "900", textAlign: "center" },
  body: { color: colors.textDim, fontSize: 14, lineHeight: 21, textAlign: "center", maxWidth: 560 },
  detailCard: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, backgroundColor: colors.surface, marginTop: space(4), overflow: "hidden" },
  detailRow: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: space(3), paddingHorizontal: space(3), paddingVertical: space(2), borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  detailLabel: { width: 130, color: colors.textFaint, fontFamily: mono, fontSize: 9, lineHeight: 14, fontWeight: "900", letterSpacing: 0.8, textTransform: "uppercase" },
  detailValue: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 19, fontWeight: "700" },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: space(2), borderWidth: 1, borderColor: colors.gold + "66", borderRadius: radius.md, backgroundColor: colors.gold + "0D", padding: space(3), marginTop: space(3) },
  noticeDanger: { borderColor: colors.danger + "66", backgroundColor: colors.danger + "0D" },
  noticeText: { flex: 1, color: colors.gold, fontSize: 12, lineHeight: 18, fontWeight: "700" },
  passwordLabel: { color: colors.textDim, fontFamily: mono, fontSize: 10, fontWeight: "900", letterSpacing: 1, marginTop: space(5), marginBottom: space(1) },
  passwordInput: { minHeight: 52, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, backgroundColor: colors.surface, color: colors.text, paddingHorizontal: space(3), fontSize: 16 },
  passwordHint: { color: colors.textFaint, fontSize: 11, lineHeight: 16, marginTop: space(1) },
  error: { color: colors.danger, fontSize: 12, lineHeight: 18, fontWeight: "700", marginTop: space(2) },
  decisionRow: { flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(4) },
  decisionButton: { minHeight: 50, flexGrow: 1, flexBasis: 240, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space(2), borderRadius: radius.md, borderWidth: 1, paddingHorizontal: space(3), paddingVertical: space(2) },
  approveButton: { backgroundColor: colors.amberStrong, borderColor: colors.amberStrong },
  rejectButton: { backgroundColor: colors.danger + "0D", borderColor: colors.danger },
  decisionText: { fontSize: 12, fontWeight: "900", letterSpacing: 0.4 },
  approveText: { color: "#1A1206" },
  rejectText: { color: colors.danger },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.76, transform: [{ scale: 0.99 }] },
  primaryButton: { minHeight: 50, width: "100%", maxWidth: 360, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: colors.amberStrong, marginTop: space(3) },
  primaryText: { color: "#1A1206", fontSize: 13, fontWeight: "900", letterSpacing: 0.5 },
  secondaryButton: { minHeight: 48, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingHorizontal: space(4), marginTop: space(2) },
  secondaryText: { color: colors.text, fontSize: 12, fontWeight: "900" },
  receiptCard: { width: "100%", maxWidth: 560, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, backgroundColor: colors.surface, padding: space(3), gap: space(1) },
  receiptValue: { color: colors.text, fontFamily: mono, fontSize: 12, marginBottom: space(2) },
  receiptStamp: { color: colors.cool, fontFamily: mono, fontSize: 10, lineHeight: 16, marginBottom: space(2) },
});
